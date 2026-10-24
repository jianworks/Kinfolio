import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  createAuth,
  currentUser,
  hash,
  claimsUser,
  isDev,
} from "../src/auth.js";
test("Google redirect protocol, D1 sessions and local-only bypass", async (t) => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await db.batch(
      [
        "CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT)",
        "CREATE TABLE revisions(user_id TEXT PRIMARY KEY,version INTEGER DEFAULT 0)",
        "CREATE TABLE oauth_requests(id TEXT PRIMARY KEY,nonce TEXT,verifier TEXT,expires_at INTEGER)",
        "CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER)",
      ].map((s) => db.prepare(s)),
    );
    const origin = "https://kinfolio.example",
      env = {
        DB: db,
        APP_URL: origin,
        GOOGLE_CLIENT_ID: "test-id",
        GOOGLE_CLIENT_SECRET: "test-secret",
      };
    let expectedNonce,
      expectedChallenge,
      exchanges = 0,
      subject = "google-user";
    const route = createAuth({
      exchangeCode: async (p) => {
        exchanges++;
        assert.equal(p.client_secret, "test-secret");
        assert.equal(p.redirect_uri, origin + "/auth/google/callback");
        assert.equal(await hash(p.code_verifier), expectedChallenge);
        return "verified-token";
      },
      verifyIdToken: async (token, audience) => {
        assert.equal(token, "verified-token");
        assert.equal(audience, "test-id");
        return {
          sub: subject,
          email: "owner@mrandmrsjian.com",
          name: "Owner",
          email_verified: true,
          hd: "mrandmrsjian.com",
          nonce: expectedNonce,
        };
      },
    });
    const begin = async () => {
      const r = await route(new Request(origin + "/auth/google"), env);
      assert.equal(r.status, 302);
      const url = new URL(r.headers.get("Location"));
      assert.equal(url.origin, "https://accounts.google.com");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      expectedNonce = url.searchParams.get("nonce");
      expectedChallenge = url.searchParams.get("code_challenge");
      const state = url.searchParams.get("state");
      const c = r.headers.get("Set-Cookie");
      assert.match(c, /HttpOnly/);
      assert.match(c, /Secure/);
      assert.match(c, /SameSite=Lax/);
      const pending = await db
        .prepare("SELECT * FROM oauth_requests WHERE id=?")
        .bind(await hash(state))
        .first();
      assert.ok(pending);
      assert.notEqual(pending.id, state);
      return { state, cookie: c.split(";")[0] };
    };
    await t.test(
      "public config works without credentials or SESSION_SECRET",
      async () => {
        const r = await route(new Request(origin + "/api/config"), { DB: db });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).googleConfigured, false);
      },
    );
    await t.test(
      "successful callback, replay prevention and server-side logout",
      async () => {
        const b = await begin(),
          callback = new Request(
            origin +
              "/auth/google/callback?state=" +
              b.state +
              "&code=one-time-code",
            { headers: { Cookie: b.cookie } },
          );
        const r = await route(callback, env);
        assert.equal(r.headers.get("Location"), "/");
        const raw = r.headers
          .getSetCookie()
          .find((c) => c.startsWith("__Host-kinfolio_session="));
        assert.ok(raw);
        const c = raw.split(";")[0],
          token = c.slice(c.indexOf("=") + 1),
          saved = await db
            .prepare("SELECT * FROM sessions WHERE id=?")
            .bind(await hash(token))
            .first();
        assert.ok(saved);
        assert.notEqual(saved.id, token);
        const authenticated = new Request(origin + "/api/state", {
          headers: { Cookie: c },
        });
        assert.equal((await currentUser(authenticated, env)).id, subject);
        const replay = await route(callback, env);
        assert.match(replay.headers.get("Location"), /auth_error=state/);
        assert.equal(exchanges, 1);
        const blocked = await route(
          new Request(origin + "/api/auth/logout", {
            method: "POST",
            headers: { Cookie: c, Origin: "https://evil.example" },
          }),
          env,
        );
        assert.equal(blocked.status, 403);
        assert.ok(await currentUser(authenticated, env));
        const logout = await route(
          new Request(origin + "/api/auth/logout", {
            method: "POST",
            headers: { Cookie: c, Origin: origin },
          }),
          env,
        );
        assert.equal(logout.status, 200);
        assert.equal(await currentUser(authenticated, env), null);
      },
    );
    await t.test(
      "state mismatch, expiry, cancellation and wrong origin",
      async () => {
        const b = await begin();
        const req = (query, cookie = b.cookie) =>
          new Request(origin + "/auth/google/callback?" + query, {
            headers: { Cookie: cookie },
          });
        assert.match(
          (
            await route(req("state=" + b.state + "&code=x", ""), env)
          ).headers.get("Location"),
          /auth_error=state/,
        );
        await db
          .prepare("UPDATE oauth_requests SET expires_at=0 WHERE id=?")
          .bind(await hash(b.state))
          .run();
        assert.match(
          (await route(req("state=" + b.state + "&code=x"), env)).headers.get(
            "Location",
          ),
          /auth_error=state/,
        );
        const c = await begin();
        assert.match(
          (
            await route(
              req("state=" + c.state + "&error=access_denied", c.cookie),
              env,
            )
          ).headers.get("Location"),
          /auth_error=cancelled/,
        );
        assert.equal(
          (await route(new Request("https://evil.example/auth/google"), env))
            .status,
          400,
        );
        assert.equal(exchanges, 1);
      },
    );
    await t.test("Google nonce, domain and verified-email enforcement", () => {
      const valid = {
        sub: "x",
        nonce: "n",
        email: "x@mrandmrsjian.com",
        email_verified: true,
        hd: "mrandmrsjian.com",
      };
      assert.equal(claimsUser(valid, "n").id, "x");
      for (const change of [
        { nonce: "wrong" },
        { hd: "other.com" },
        { email: "x@other.com" },
        { email_verified: false },
        { sub: "" },
      ])
        assert.throws(() => claimsUser({ ...valid, ...change }, "n"));
    });
    await t.test("expired and forged sessions are rejected", async () => {
      await db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .bind(await hash("expired"), "google-user", 0)
        .run();
      for (const token of ["expired", "forged", "old.jwt.token"])
        assert.equal(
          await currentUser(
            new Request(origin, {
              headers: { Cookie: "__Host-kinfolio_session=" + token },
            }),
            env,
          ),
          null,
        );
    });
    await t.test(
      "local bypass needs both explicit flag and loopback host",
      async () => {
        for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
          const request = new Request("http://" + host + ":8787/api/state");
          assert.equal(isDev(request, { DEV_AUTH: "true" }), true);
          assert.equal(
            (await currentUser(request, { DB: db, DEV_AUTH: "true" })).id,
            "local-development",
          );
          assert.equal(isDev(request, {}), false);
        }
        const request = new Request(origin + "/api/state");
        assert.equal(isDev(request, { DEV_AUTH: "true" }), false);
        assert.equal(
          await currentUser(request, { DB: db, DEV_AUTH: "true" }),
          null,
        );
      },
    );
  } finally {
    await mf.dispose();
  }
});
