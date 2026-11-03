import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBase, priceDistances } from "../public/watchlist-domain.js";
import {
  parseHistory,
  completedDay,
  watchStatements,
  refreshHistory,
} from "../src/watchlist.js";
const bar = (i, low = 100, high = 110, close = 105) => ({
  date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
  low,
  high,
  close,
});
const base = () => Array.from({ length: 80 }, (_, i) => bar(i));
test("base, breakout, subsequent retest and failure preserve original levels", () => {
  const bars = base();
  assert.equal(analyzeBase(bars).stage, "築底觀察");
  bars.push(bar(80, 111, 115, 114));
  assert.equal(analyzeBase(bars).stage, "突破待確認");
  bars.push(bar(81, 109, 113, 111));
  assert.equal(analyzeBase(bars).stage, "回測確認");
  bars.push(bar(82, 97, 100, 98));
  const r = analyzeBase(bars);
  assert.equal(r.stage, "型態失效");
  assert.equal(r.support, 100);
  assert.equal(r.ceiling, 110);
});
test("breakout day cannot confirm its own retest and late retests do not qualify", () => {
  const b = base();
  b.push(bar(80, 109, 115, 114));
  assert.equal(analyzeBase(b).stage, "突破待確認");
  for (let i = 81; i < 91; i++) b.push(bar(i, 115, 120, 118));
  b.push(bar(91, 109, 113, 111));
  assert.equal(analyzeBase(b).stage, "突破待確認");
});
test("falling, insufficient and unformed data do not pretend to be a base", () => {
  assert.equal(analyzeBase([]).stage, "資料不足");
  const b = Array.from({ length: 80 }, (_, i) =>
    bar(i, 200 - i, 210 - i, 205 - i),
  );
  assert.equal(analyzeBase(b).stage, "下跌中");
  const rising = Array.from({ length: 80 }, (_, i) =>
    bar(i, 100 + i * 4, 105 + i * 4, 102 + i * 4),
  );
  assert.equal(analyzeBase(rising).stage, "尚未形成");
});
test("completed sessions follow Taipei cutoff", () => {
  assert.equal(completedDay(new Date("2026-11-03T07:59:00Z")), "2026-11-02");
  assert.equal(completedDay(new Date("2026-11-03T08:00:00Z")), "2026-11-03");
});
test("history validates identity, rejects bad candles, sorts and excludes unfinished dates", () => {
  const payload = {
    symbol: "2330",
    exchange: "TWSE",
    data: [bar(2), bar(0), bar(1)],
  };
  assert.deepEqual(parseHistory(payload, "TWSE", "2330", bar(1).date), [
    bar(0),
    bar(1),
  ]);
  assert.throws(() => parseHistory(payload, "TPEX", "2330", "2026-01-01"));
  assert.throws(() =>
    parseHistory(
      { ...payload, data: [bar(0), bar(0)] },
      "TWSE",
      "2330",
      "2026-01-01",
    ),
  );
  assert.throws(() =>
    parseHistory(
      { ...payload, data: [bar(0, 120, 110)] },
      "TWSE",
      "2330",
      "2026-01-01",
    ),
  );
});
test("watchlist validation enforces tenant ownership, duplicates and market", async () => {
  await assert.rejects(() =>
    watchStatements({}, { id: "a" }, { remove: true, id: "other" }, []),
  );
  await assert.rejects(() =>
    watchStatements({}, { id: "a" }, { market: "US", symbol: "AAPL" }, []),
  );
  await assert.rejects(() =>
    watchStatements({}, { id: "a" }, { market: "TWSE", symbol: "2330" }, [
      { market: "TWSE", symbol: "2330" },
    ]),
  );
});
test("missing key preserves history and reports a safe error", async () => {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            calls.push({ sql, args });
            return this;
          },
          async run() {},
          async first() {
            return { symbol: "2330" };
          },
        };
      },
    },
  };
  await refreshHistory(env, "TWSE", "2330", () => {
    throw Error("must not fetch");
  });
  assert.match(calls.at(-1).args[0], /尚未設定/);
  assert.doesNotMatch(calls.at(-1).sql, /payload=/);
});

test("watchlist ignores submitted names and saves the resolved name", async () => {
  let saved;
  const db = {
    prepare() {
      return {
        bind(...args) {
          saved = args;
          return this;
        },
      };
    },
  };
  await watchStatements(
    db,
    { id: "a" },
    { market: "TWSE", symbol: "2330", name: "incorrect" },
    [],
    {},
    async () => "台積電",
  );
  assert.equal(saved[4], "台積電");
  await assert.rejects(
    () =>
      watchStatements(
        db,
        { id: "a" },
        { market: "TWSE", symbol: "2330" },
        [],
        {},
        async () => {
          throw Error("secret provider error");
        },
      ),
    /無法取得股票名稱/,
  );
});

import { getStockName } from "../src/market-data.js";
test("name lookup validates market, falls back to exchange and caches official name", async () => {
  const writes = [];
  const env = {
    FUGLE_API_KEY: "test",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            return null;
          },
          async run() {
            writes.push(this.args);
          },
        };
      },
    },
  };
  let requests = 0;
  const result = await getStockName(env, "TPEX", "6488", async () => {
    requests++;
    return requests === 1
      ? { symbol: "6488", exchange: "TWSE", name: "wrong market" }
      : [{ SecuritiesCompanyCode: "6488", CompanyName: "環球晶" }];
  });
  assert.equal(result, "環球晶");
  assert.equal(requests, 2);
  assert.deepEqual(writes[0].slice(0, 3), ["TPEX", "6488", "環球晶"]);
  await assert.rejects(
    () =>
      getStockName(env, "TWSE", "2330", async () => [
        { Code: "2317", Name: "鴻海" },
      ]),
    /無法取得股票名稱/,
  );
});
test("fresh stock names avoid remote requests and failures do not become cached names", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return {
              name: "台積電",
              fetched_at: Math.floor(Date.now() / 1000),
            };
          },
        };
      },
    },
  };
  assert.equal(
    await getStockName(env, "TWSE", "2330", () => {
      throw Error("must not fetch");
    }),
    "台積電",
  );
});

test("year distances use exactly 252 sessions, adjusted close and dates of latest equal extremes", () => {
  const bars = Array.from({ length: 253 }, (_, i) => bar(i, 100, 150, 120));
  bars[0] = bar(0, 1, 1000, 120);
  const r = priceDistances(bars, { stage: "築底觀察", support: 110 });
  assert.equal(r.sessions, 252);
  assert.equal(r.low.price, 100);
  assert.equal(r.high.price, 150);
  assert.equal(r.low.date, bars.at(-1).date);
  assert.equal(r.high.date, bars.at(-1).date);
  assert.ok(Math.abs(r.fromLow - 20) < 1e-10);
  assert.ok(Math.abs(r.fromHigh + 20) < 1e-10);
  assert.ok(Math.abs(r.fromSupport - (120 / 110 - 1) * 100) < 1e-10);
  assert.equal(r.close, 120);
  assert.equal(r.date, bars.at(-1).date);
});
test("short histories do not claim annual extremes; failed patterns do not keep support returns", () => {
  assert.equal(priceDistances([]), null);
  const partial = priceDistances(base(), { stage: "型態失效", support: 100 });
  assert.equal(partial.complete, false);
  assert.equal(partial.sessions, 80);
  assert.equal(partial.low, null);
  assert.equal(partial.fromHigh, null);
  assert.equal(partial.fromSupport, null);
  const support = priceDistances(base(), { stage: "築底觀察", support: 100 });
  assert.ok(Math.abs(support.fromSupport - 5) < 1e-10);
  const flat = priceDistances(
    Array.from({ length: 252 }, (_, i) => bar(i, 100, 100, 100)),
  );
  assert.equal(flat.fromLow, 0);
  assert.equal(flat.fromHigh, 0);
});

test("extended history uses non-overlapping short requests and supports recently listed stocks", async () => {
  const writes = [],
    urls = [];
  const env = {
    FUGLE_API_KEY: "fixture",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            this.args = args;
            return this;
          },
          async first() {
            return { symbol: "2330" };
          },
          async run() {
            writes.push({ sql, args: this.args });
          },
        };
      },
    },
  };
  const end = completedDay();
  await refreshHistory(env, "TWSE", "2330", async (url) => {
    const u = new URL(url);
    urls.push(u);
    const bars =
      urls.length === 1 ? [] : [{ date: end, low: 100, high: 120, close: 110 }];
    return Response.json({ symbol: "2330", exchange: "TWSE", data: bars });
  });
  assert.equal(urls.length, 2);
  for (const u of urls) {
    assert.ok(
      Date.parse(u.searchParams.get("to")) -
        Date.parse(u.searchParams.get("from")) <
        365 * 86400000,
    );
    assert.equal(u.searchParams.get("adjusted"), "true");
  }
  assert.equal(
    Date.parse(urls[1].searchParams.get("from")) -
      Date.parse(urls[0].searchParams.get("to")),
    86400000,
  );
  const saved = writes.find((w) => w.sql.includes("SET payload="));
  assert.ok(saved);
  assert.equal(JSON.parse(saved.args[0]).length, 1);
  assert.equal(saved.args[1], "range252:" + end);
});
