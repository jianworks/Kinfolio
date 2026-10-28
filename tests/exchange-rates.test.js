import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  parseExchangeRate,
  createExchangeRateService,
} from "../src/exchange-rates.js";
test("reference rates validate currency, positive values, timestamps and millionth precision", () => {
  const now = Math.floor(Date.now() / 1000),
    d = {
      result: "success",
      base_code: "USD",
      rates: { TWD: 32.592411 },
      time_last_update_unix: now - 100,
    };
  assert.equal(parseExchangeRate("USD", d, now).rate, 32592411);
  for (const bad of [
    { ...d, base_code: "JPY" },
    { ...d, rates: { TWD: 0 } },
    { ...d, time_last_update_unix: now + 1000 },
    { ...d, result: "error" },
  ])
    assert.throws(() => parseExchangeRate("USD", bad, now));
});
test("exchange-rate cache avoids repeated calls and retains the last rate on failure", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
    }),
  );
  try {
    const DB = await mf.getD1Database("DB");
    await DB.prepare(
      "CREATE TABLE quote_cache(market TEXT,symbol TEXT,price INTEGER,price_date TEXT,source TEXT,fetched_at INTEGER DEFAULT 0,last_attempt INTEGER DEFAULT 0,error TEXT DEFAULT '',PRIMARY KEY(market,symbol))",
    ).run();
    let now = Math.floor(Date.now() / 1000),
      calls = 0,
      fail = false;
    const get = createExchangeRateService({
      clock: () => now,
      fetchData: async (currency) => {
        calls++;
        if (fail) throw Error("private provider details");
        return {
          result: "success",
          base_code: currency,
          rates: { TWD: 32.5 },
          time_last_update_unix: now - 30,
        };
      },
    });
    assert.equal((await get({ DB }, "TWD")).rate, 1000000);
    assert.equal(calls, 0);
    assert.equal((await get({ DB }, "USD")).rate, 32500000);
    await get({ DB }, "USD");
    assert.equal(calls, 1);
    now += 3601;
    fail = true;
    const old = await get({ DB }, "USD");
    assert.equal(old.rate, 32500000);
    assert.match(old.warning, /沿用/);
    assert.ok(!old.warning.includes("private"));
    await get({ DB }, "USD");
    assert.equal(calls, 2);
    now += 601;
    fail = false;
    assert.equal((await get({ DB }, "USD")).warning, null);
    assert.equal(calls, 3);
  } finally {
    await mf.dispose();
  }
});
