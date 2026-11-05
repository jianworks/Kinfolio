import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import worker from "../src/worker.js";
import { hash } from "../src/auth.js";
import { FUTURES_ACCOUNT_ID as id } from "../src/futures.js";
import { restoreEstimates } from "../public/estimate-state.js";
import { today } from "../public/domain.js";

test("futures integration is account-scoped, ordered, private and independent of manual history", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const triggers = [];
      const sql = readFileSync(
        new URL("../migrations/" + file, import.meta.url),
        "utf8",
      )
        .replace(/^--.*$/gm, "")
        .replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, (t) => {
          triggers.push(t);
          return `TRIGGER_${triggers.length - 1};`;
        });
      for (let s of sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (s.startsWith("PRAGMA")) continue;
        if (s.startsWith("TRIGGER_")) s = triggers[Number(s.slice(8))];
        await db.prepare(s).run();
      }
    }
    await db.batch([
      db.prepare(
        "INSERT INTO users VALUES('owner','owner@example.com','Owner'),('member','cc.chang@mrandmrsjian.com','Member')",
      ),
      db.prepare("INSERT INTO revisions(user_id) VALUES('owner'),('member')"),
      db.prepare(
        "INSERT INTO holders VALUES('holder','owner','Owner'),('restricted','owner','張佳琪')",
      ),
      db
        .prepare(
          "INSERT INTO accounts VALUES(?,'owner','holder','Futures','期貨','TWD','2020-01-01')",
        )
        .bind(id),
      db
        .prepare(
          "INSERT INTO events(user_id,account_id,date,kind,amount,cost_delta,cost_twd_delta,rate) VALUES('owner',?,'2020-01-01','opening',10000,10000,10000,1000000)",
        )
        .bind(id),
      db
        .prepare(
          "INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?),(?,?,?)",
        )
        .bind(
          await hash("owner"),
          "owner",
          Math.floor(Date.now() / 1000) + 3600,
          await hash("member"),
          "member",
          Math.floor(Date.now() / 1000) + 3600,
        ),
    ]);
    const key = "test-only-key-with-at-least-32-characters";
    const env = {
      DB: db,
      FUTURES_SYNC_KEY: key,
      FAMILY_DATA_OWNER_EMAIL: "owner@example.com",
    };
    async function call(
      path,
      body,
      {
        token,
        person,
        customEnv = env,
        method = body === undefined ? "GET" : "POST",
      } = {},
    ) {
      const r = await worker.fetch(
        new Request("https://kinfolio.example/api/" + path, {
          method,
          headers: {
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...(person ? { Cookie: "__Host-kinfolio_session=" + person } : {}),
            ...(body === undefined
              ? {}
              : {
                  "Content-Type": "application/json",
                  ...(person ? { Origin: "https://kinfolio.example" } : {}),
                }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        customEnv,
      );
      return { status: r.status, data: await r.json() };
    }
    const path = "integrations/futures-equity";
    const observedAt = new Date(Date.now() - 10000).toISOString();
    const payload = {
      equity: "12345.67",
      currency: "TWD",
      dataDate: today(),
      observedAt,
    };
    const sync = (p = payload, opts = {}) =>
      call(path, p, { token: key, ...opts });
    assert.equal((await sync(payload, { token: undefined })).status, 401);
    assert.equal((await sync(payload, { token: "wrong" })).status, 401);
    assert.equal(
      (await sync(payload, { customEnv: { ...env, FUTURES_SYNC_KEY: "" } }))
        .status,
      503,
    );
    assert.equal((await call(path, undefined, { token: key })).status, 405);
    assert.equal((await sync({ ...payload, accountId: "other" })).status, 400);
    assert.equal((await sync({ ...payload, equity: -1 })).status, 400);
    assert.equal((await sync({ ...payload, equity: 1.234 })).status, 400);
    assert.equal((await sync({ ...payload, equity: [] })).status, 400);
    assert.equal((await sync({ ...payload, currency: "USD" })).status, 400);
    assert.equal(
      (await sync({ ...payload, observedAt: "2026-11-04T10:00:00" })).status,
      400,
    );
    assert.equal(
      (
        await sync({
          ...payload,
          observedAt: new Date(Date.now() + 120000).toISOString(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await sync({ ...payload, extra: "x".repeat(4100) })).status,
      413,
    );
    assert.equal((await sync()).data.status, "updated");
    assert.equal((await sync()).data.status, "unchanged");
    assert.equal((await sync({ ...payload, equity: 900 })).status, 409);
    assert.equal(
      (
        await sync({
          ...payload,
          observedAt: new Date(Date.parse(observedAt) - 1000).toISOString(),
        })
      ).status,
      409,
    );
    let state = (await call("state", undefined, { person: "owner" })).data;
    assert.equal(state.events.length, 1);
    assert.equal(state.revisions[0].version, 0);
    assert.equal(state.futures_current[0].amount, 1234567);
    assert.equal(restoreEstimates(state).get(id).total, 1234567);
    const member = (await call("state", undefined, { person: "member" })).data;
    assert.equal(member.futures_current.length, 0);
    assert.equal(
      (await call("export", undefined, { person: "member" })).data
        .futures_current.length,
      0,
    );
    assert.equal((await call("state", undefined, { token: key })).status, 401);
    const snap = {
      accountId: id,
      syncId: state.futures_current[0].sync_id,
      version: 0,
    };
    assert.equal(
      (await call("futures-snapshot", snap, { token: key })).status,
      403,
    );
    assert.equal(
      (await call("futures-snapshot", snap, { person: "member" })).status,
      400,
    );
    assert.equal(
      (await call("futures-snapshot", snap, { person: "owner" })).status,
      200,
    );
    state = (await call("state", undefined, { person: "owner" })).data;
    assert.equal(state.events.length, 2);
    assert.equal(state.events[1].kind, "valuation");
    assert.equal(state.events[1].cost_delta, 0);
    assert.equal(state.events[1].cost_twd_delta, 0);
    assert.equal(
      JSON.parse(state.events[1].futures_details_json).observed_at,
      observedAt,
    );
    assert.equal(
      (
        await call(
          "futures-snapshot",
          { ...snap, version: 1 },
          { person: "owner" },
        )
      ).status,
      409,
    );
    const newer = {
      ...payload,
      equity: 14000,
      observedAt: new Date(Date.parse(observedAt) + 1000).toISOString(),
    };
    assert.equal((await sync(newer)).status, 200);
    assert.equal(
      (
        await call(
          "futures-snapshot",
          { ...snap, version: 1 },
          { person: "owner" },
        )
      ).status,
      400,
    );
    // The database guard also rejects a change occurring after snapshot validation.
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO events(user_id,account_id,date,kind,amount,rate,futures_sync_id) VALUES('owner',?,?,'valuation',1234567,1000000,?)",
        )
        .bind(id, today(), snap.syncId)
        .run(),
      /STALE_VERSION/,
    );
    state = (await call("state", undefined, { person: "owner" })).data;
    assert.equal(state.events[1].amount, 1234567);
    assert.equal(state.futures_current[0].amount, 1400000);
    const exported = (await call("export", undefined, { person: "owner" }))
      .data;
    assert.equal(exported.futures_current.length, 1);
    assert.ok(!JSON.stringify(exported).includes(key));
  } finally {
    await mf.dispose();
  }
});
