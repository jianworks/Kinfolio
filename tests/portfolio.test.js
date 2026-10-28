import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  decimal,
  symbolFor,
  positionValue,
  portfolioValue,
  SCALE,
} from "../public/portfolio-domain.js";
import { FX, today } from "../public/domain.js";
import {
  parseQuote,
  createQuoteService,
  fetchMarketQuote,
  parseBackupQuote,
  parseFugleQuote,
} from "../src/market-data.js";
import { estimates as rawEstimates } from "../src/portfolios.js";
const estimates = (...args) =>
  rawEstimates(...args, async (env, currency) => ({
    rate: currency === "TWD" ? FX : 32 * FX,
    date: today(),
    source: "Test FX",
    warning: null,
  }));
test("Fugle is the primary Taiwan provider with exchange validation and official fallback", async () => {
  const fixture = {
    symbol: "00955",
    exchange: "TPEx",
    date: "2026-10-27",
    isClose: true,
    closePrice: 16.83,
    lastPrice: 99,
  };
  const q = parseFugleQuote("TPEX", "00955", fixture);
  assert.equal(q.price, 16830000);
  assert.equal(q.source, "富果（日收盤）");
  const trade = parseFugleQuote("TPEX", "00955", {
    ...fixture,
    isClose: false,
    isTrial: true,
    lastTrial: { price: 999 },
    lastTrade: { price: 16.82 },
  });
  assert.equal(trade.price, 16820000);
  assert.equal(trade.source, "富果（最近成交）");
  for (const bad of [
    { ...fixture, symbol: "00956" },
    { ...fixture, exchange: "TWSE" },
    { ...fixture, closePrice: 0 },
    { ...fixture, isClose: false, lastTrade: null },
    { ...fixture, date: "2026-02-30" },
  ])
    assert.throws(() => parseFugleQuote("TPEX", "00955", bad));
  let calls = 0;
  const env = { FUGLE_API_KEY: "private-fugle-key" };
  const primary = await fetchMarketQuote(
    "TPEX",
    "00955",
    async (url, publicData, options) => {
      calls++;
      assert.equal(publicData, false);
      assert.equal(options.headers["X-API-KEY"], env.FUGLE_API_KEY);
      assert.ok(!url.includes(env.FUGLE_API_KEY));
      return fixture;
    },
    env,
  );
  assert.equal(calls, 1);
  assert.equal(primary.source, "富果（日收盤）");
  const fallback = await fetchMarketQuote(
    "TWSE",
    "2330",
    async (url) => {
      if (url.includes("api.fugle.tw"))
        throw Error("unauthorized private-fugle-key");
      return [{ Code: "2330", Date: "1151027", ClosingPrice: "2,400" }];
    },
    env,
  );
  assert.equal(fallback.price, 2400000000);
  assert.match(fallback.source, /證交所.*備援/);
  assert.ok(!JSON.stringify(fallback).includes(env.FUGLE_API_KEY));
});
test("US provider quota notices are distinguished from missing symbols without exposing keys", () => {
  assert.throws(
    () =>
      parseQuote("US", "GOOG", {
        error: "API limit reached private-key",
      }),
    (error) =>
      /額度或頻率限制/.test(error.message) &&
      !error.message.includes("private-key"),
  );
  assert.throws(
    () =>
      parseQuote("US", "GOOG", {
        error: "API limit reached",
      }),
    /額度或頻率限制/,
  );
  assert.throws(
    () =>
      parseQuote("US", "GOOG", {
        error: "Invalid API key private-key",
      }),
    (error) =>
      /密鑰無效/.test(error.message) && !error.message.includes("private-key"),
  );
  assert.throws(
    () => parseQuote("US", "UNKNOWN", { c: 0, t: 0 }),
    /未回傳此代號/,
  );
});
test("Finnhub validates prices and timestamps and uses the New York trading date", () => {
  const q = parseQuote("US", "GOOG", {
    c: 123.4567,
    t: Math.floor(Date.parse("2026-10-24T00:00:00Z") / 1000),
  });
  assert.equal(q.price_date, "2026-10-23");
  assert.equal(q.source, "Finnhub（最近成交）");
  for (const data of [
    { c: 0, t: 1 },
    { c: -1, t: 1 },
    { c: 100, t: 0 },
    { c: 100, t: Date.now() },
    { c: 100 },
  ])
    assert.throws(() => parseQuote("US", "GOOG", data));
});
test("TPEX 00955 still receives a price when the primary host times out in Workers", async () => {
  const calls = [];
  const fixture = {
    rtcode: "0000",
    msgArray: [
      { c: "00955", ex: "otc", d: "20261022", t: "13:30:00", z: "16.5100" },
    ],
  };
  const q = await fetchMarketQuote(
    "TPEX",
    "00955",
    async (url, publicData, options) => {
      calls.push({ url, publicData, options });
      if (url.includes("tpex.org.tw"))
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      return fixture;
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.timeoutMs, 4000);
  assert.equal(new URL(calls[1].url).searchParams.get("ex_ch"), "otc_00955.tw");
  assert.equal(q.price, 16510000);
  assert.equal(q.price_date, "2026-10-22");
  assert.match(q.source, /證交所基本市況.*最近成交.*備援/);
  const primary = await fetchMarketQuote("TPEX", "00955", async () => [
    { SecuritiesCompanyCode: "00955", Date: "1151022", Close: "16.51" },
  ]);
  assert.equal(primary.source, "櫃買中心（日收盤）");
  for (const row of [
    { ...fixture.msgArray[0], c: "00956" },
    { ...fixture.msgArray[0], ex: "tse" },
    { ...fixture.msgArray[0], z: "-" },
    { ...fixture.msgArray[0], d: "20260230" },
  ])
    assert.throws(() =>
      parseBackupQuote("00955", { ...fixture, msgArray: [row] }),
    );
  assert.throws(() =>
    parseBackupQuote("00955", { ...fixture, rtcode: "5000" }),
  );
  await assert.rejects(
    fetchMarketQuote("TPEX", "00955", async () => {
      throw Error("offline");
    }),
  );
});
test("fractional shares and micro prices round only the final position to currency cents", () => {
  assert.equal(decimal(".125", "shares"), 125000);
  assert.equal(decimal("1.000001", "shares"), 1000001);
  assert.equal(
    positionValue(decimal("1.5", "q"), decimal("123.456789", "p")),
    18519,
  );
  assert.equal(
    positionValue(decimal(".000001", "q"), decimal("1000000", "p")),
    100,
  );
  const result = portfolioValue(10000, 32 * FX, [
    { quantity: 1500000, price: 123456789 },
  ]);
  assert.equal(result.total, 28519);
  assert.equal(result.totalTwd, 912608);
  for (const v of ["-1", "NaN", "Infinity", "1.0000001", "1e6", "0"])
    assert.throws(() => decimal(v, "q"));
  assert.throws(() => positionValue(1e15, 1e15));
});
test("missing price never produces a complete or understated account total", () => {
  const r = portfolioValue(10000, FX, [
    { quantity: SCALE, price: null },
    { quantity: SCALE, price: 200 * SCALE },
  ]);
  assert.equal(r.complete, false);
  assert.equal(r.total, null);
  assert.equal(r.totalTwd, null);
  assert.equal(r.holdings[0].value, null);
  assert.equal(r.holdings[1].value, 20000);
  assert.equal(portfolioValue(0, FX, []).total, 0);
});
test("market symbols and provider response identities are validated", () => {
  assert.equal(symbolFor("US", "aapl"), "AAPL");
  assert.equal(symbolFor("TWSE", "0050"), "0050");
  assert.equal(symbolFor("TWSE", "00400A"), "00400A");
  assert.throws(() => symbolFor("US", "../../keys"));
  assert.throws(() => symbolFor("TPEX", "AAPL"));
  const tw = parseQuote("TWSE", "2330", [
    { Code: "2330", Date: "1090102", ClosingPrice: "1,000.50" },
  ]);
  assert.equal(tw.price, 1000500000);
  assert.equal(tw.price_date, "2020-01-02");
  assert.equal(
    parseQuote("TPEX", "6488", [
      { SecuritiesCompanyCode: "6488", Date: "1090102", Close: "100.25" },
    ]).price,
    100250000,
  );
  assert.throws(() =>
    parseQuote("TWSE", "2330", [
      { Code: "2330", Date: "1090102", ClosingPrice: "--" },
    ]),
  );
  assert.throws(() =>
    parseQuote("US", "AAPL", {
      "Global Quote": {
        "01. symbol": "MSFT",
        "05. price": "100",
        "07. latest trading day": "2020-01-02",
      },
    }),
  );
  assert.throws(() =>
    parseQuote("US", "AAPL", { Information: "limit reached" }),
  );
});
test("real D1 quote cache retains old prices on failure, limits provider calls and recovers after key setup", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await db.batch([
      db.prepare(
        "CREATE TABLE quote_cache(market TEXT,symbol TEXT,price INTEGER,price_date TEXT,source TEXT,fetched_at INTEGER DEFAULT 0,last_attempt INTEGER DEFAULT 0,error TEXT DEFAULT '',PRIMARY KEY(market,symbol))",
      ),
      db.prepare(
        "CREATE TABLE quote_limits(provider TEXT,day TEXT,count INTEGER,PRIMARY KEY(provider,day))",
      ),
    ]);
    let now = Math.floor(Date.parse(today() + "T00:00:00Z") / 1000),
      calls = 0,
      fail = false;
    const quote = createQuoteService({
      clock: () => now,
      fetchData: async (url, publicData, options) => {
        assert.equal(
          options.headers["X-Finnhub-Token"],
          "private-key-not-for-clients",
        );
        assert.ok(!url.includes("private-key"));
        calls++;
        if (fail) throw Error("network failure apikey=do-not-expose");
        return { c: 123.4567, t: 1578002400 };
      },
    });
    const env = {
      DB: db,
      FINNHUB_API_KEY: "private-key-not-for-clients",
      FINNHUB_PER_MINUTE_LIMIT: 100,
    };
    const first = await quote(env, "US", "AAPL");
    assert.equal(first.price, 123456700);
    assert.equal(calls, 1);
    assert.equal((await quote(env, "US", "AAPL")).price, first.price);
    assert.equal(calls, 1);
    now += 901;
    fail = true;
    const old = await quote(env, "US", "AAPL");
    assert.equal(old.price, first.price);
    assert.ok(old.warning);
    assert.ok(!old.warning.includes("do-not-expose"));
    assert.equal(calls, 2);
    await quote(env, "US", "AAPL");
    assert.equal(calls, 2);
    fail = false;
    const missing = await quote({ DB: db }, "US", "MSFT");
    assert.ok(!missing.price);
    assert.match(missing.warning, /尚未啟用/);
    assert.equal((await quote(env, "US", "MSFT")).price, 123456700);
    assert.equal(calls, 3);
    now += 86400;
    const limited = { ...env, FINNHUB_PER_MINUTE_LIMIT: 1 };
    await quote(limited, "US", "VTI");
    const before = calls;
    const denied = await quote(limited, "US", "VOO");
    assert.equal(calls, before);
    assert.ok(!denied.price);
    assert.match(denied.warning, /額度已用完/);
    await db.batch([
      db.prepare(
        "CREATE TABLE portfolio_estimates(id TEXT PRIMARY KEY,user_id TEXT,account_id TEXT,version INTEGER,amount INTEGER,rate INTEGER,complete INTEGER,created_at INTEGER,expires_at INTEGER,details_json TEXT)",
      ),
      db.prepare("CREATE TABLE events(portfolio_estimate_id TEXT)"),
      db.prepare(
        "CREATE TABLE revisions(user_id TEXT PRIMARY KEY,version INTEGER)",
      ),
      db.prepare("INSERT INTO revisions VALUES('u',1)"),
      db.prepare(
        "CREATE TABLE portfolio_current(account_id TEXT PRIMARY KEY,user_id TEXT,composition_key TEXT,details_json TEXT,checked_at INTEGER,updated_at INTEGER,error TEXT)",
      ),
    ]);
    let batchCalls = 0;
    const batchedQuote = createQuoteService({
      fetchData: async (url) => {
        batchCalls++;
        return { c: 10, t: Math.floor(Date.now() / 1000) - 600 };
      },
    });
    const data = {
      accounts: [{ id: "a", type: "美股", currency: "USD" }],
      portfolios: [
        {
          account_id: "a",
          mode: "holdings",
          cash: 10000,
          rate: 32 * FX,
          data_date: today(),
        },
      ],
      holdings: Array.from({ length: 100 }, (_, i) => ({
        id: "h" + i,
        account_id: "a",
        market: "US",
        symbol: "SYM" + i,
        quantity: SCALE,
      })),
      revisions: [{ version: 1 }],
    };
    const batchEnv = { ...env, FINNHUB_PER_MINUTE_LIMIT: 1000 };
    const firstBatch = (
      await estimates(
        batchEnv,
        { id: "u" },
        { accountIds: ["a"] },
        data,
        batchedQuote,
      )
    )[0];
    assert.equal(firstBatch.pending, true);
    assert.equal(firstBatch.total, null);
    assert.equal(firstBatch.id, null);
    assert.equal(batchCalls, 5);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) AS n FROM portfolio_estimates")
          .first()
      ).n,
      0,
    );
    let completed;
    for (let i = 1; i < 20; i++)
      completed = (
        await estimates(
          batchEnv,
          { id: "u" },
          { accountIds: ["a"] },
          data,
          batchedQuote,
        )
      )[0];
    assert.equal(completed.pending, false);
    assert.equal(completed.complete, true);
    assert.equal(completed.total, 110000);
    assert.equal(batchCalls, 100);
    const cacheBefore = await db
      .prepare("SELECT * FROM portfolio_current WHERE account_id='a'")
      .first();
    const failed = (
      await estimates(
        batchEnv,
        { id: "u" },
        { accountIds: ["a"] },
        data,
        async () => ({ price: null, warning: "offline" }),
      )
    )[0];
    assert.equal(failed.complete, false);
    const cacheAfter = await db
      .prepare("SELECT * FROM portfolio_current WHERE account_id='a'")
      .first();
    assert.equal(
      cacheAfter.details_json,
      cacheBefore.details_json,
      "Incomplete updates must retain the durable complete estimate",
    );
    assert.equal(cacheAfter.updated_at, cacheBefore.updated_at);
    assert.match(cacheAfter.error, /沿用/);
    data.portfolio_current = [cacheAfter];
    await estimates(
      batchEnv,
      { id: "u" },
      { accountIds: ["a"] },
      data,
      async () => ({
        price: 10 * SCALE,
        price_date: today(),
        source: "Finnhub（最近成交）",
        warning: "provider unavailable, old cached quote",
      }),
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT details_json FROM portfolio_current WHERE account_id='a'",
          )
          .first()
      ).details_json,
      cacheBefore.details_json,
      "Returning cached quote prices after a provider failure must not change the last successful estimate timestamp",
    );
    await db.prepare("UPDATE revisions SET version=2 WHERE user_id='u'").run();
    await estimates(
      batchEnv,
      { id: "u" },
      { accountIds: ["a"] },
      data,
      async () => ({
        price: 20 * SCALE,
        price_date: today(),
        source: "Finnhub（最近成交）",
      }),
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT details_json FROM portfolio_current WHERE account_id='a'",
          )
          .first()
      ).details_json,
      cacheBefore.details_json,
      "A request using an old user revision cannot overwrite the current estimate",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) AS n FROM portfolio_estimates")
          .first()
      ).n,
      4,
    );
  } finally {
    await mf.dispose();
  }
});
