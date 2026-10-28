import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compositionKey,
  restoreEstimates,
  acceptEstimate,
  estimateNeedsRefresh,
} from "../public/estimate-state.js";
test("reload and partial/background refresh retain the last complete total instead of the historical value", () => {
  const p = {
    account_id: "a",
    mode: "holdings",
    cash: 10000,
    rate: 32_000_000,
    data_date: "2026-10-25",
  };
  const h = {
    account_id: "a",
    market: "US",
    symbol: "AAPL",
    quantity: 1_500_000,
    manual_price: null,
    manual_date: null,
  };
  const key = compositionKey(p, [h]),
    time = Date.parse("2026-10-25T10:00:00Z");
  const estimate = {
    accountId: "a",
    cash: p.cash,
    rate: p.rate,
    dataDate: p.data_date,
    holdings: [h],
    compositionKey: key,
    total: 40000,
    totalTwd: 1280000,
    complete: true,
    estimatedAt: new Date(time).toISOString(),
  };
  const data = {
    portfolios: [p],
    holdings: [h],
    portfolio_current: [
      {
        account_id: "a",
        composition_key: key,
        details_json: JSON.stringify(estimate),
        checked_at: time,
        error: "",
      },
    ],
  };
  const map = restoreEstimates(data);
  assert.equal(map.get("a").total, 40000);
  assert.equal(estimateNeedsRefresh(map.get("a"), time + 899999), false);
  assert.equal(
    estimateNeedsRefresh({ ...map.get("a"), currency: "USD" }, time + 1),
    true,
    "Legacy USD estimates must acquire automatic FX metadata",
  );
  assert.equal(
    estimateNeedsRefresh(
      { ...map.get("a"), currency: "USD", fxSource: "ExchangeRate-API" },
      time + 1,
    ),
    false,
  );
  assert.equal(estimateNeedsRefresh(map.get("a"), time + 900000), true);
  acceptEstimate(map, {
    ...estimate,
    total: null,
    totalTwd: null,
    complete: false,
    pending: true,
    checkedAt: new Date(time + 900000).toISOString(),
  });
  assert.equal(map.get("a").total, 40000);
  acceptEstimate(map, {
    ...estimate,
    total: null,
    complete: false,
    pending: false,
    checkedAt: new Date(time + 901000).toISOString(),
  });
  assert.equal(map.get("a").total, 40000);
  assert.match(map.get("a").updateWarning, /沿用/);
  assert.equal(map.get("a").estimatedAt, estimate.estimatedAt);
  acceptEstimate(map, {
    ...estimate,
    complete: true,
    refreshFailed: true,
    estimatedAt: new Date(time + 901500).toISOString(),
  });
  assert.equal(
    map.get("a").estimatedAt,
    estimate.estimatedAt,
    "Failed refreshes that return old quote prices must not advance the success timestamp",
  );
  acceptEstimate(map, {
    ...estimate,
    total: 45000,
    estimatedAt: new Date(time + 902000).toISOString(),
  });
  assert.equal(map.get("a").total, 45000);
  assert.equal(
    restoreEstimates({ ...data, portfolios: [{ ...p, cash: 20000 }] }).size,
    0,
  );
  assert.equal(
    restoreEstimates({ ...data, portfolios: [{ ...p, mode: "manual" }] }).size,
    0,
  );
  assert.equal(
    restoreEstimates({ ...data, holdings: [{ ...h, quantity: 2_000_000 }] })
      .size,
    0,
  );
  assert.equal(
    restoreEstimates({ ...data, revisions: [{ version: 999 }] }).get("a").total,
    40000,
  );
  const legacy = {
    ...data,
    portfolio_current: [{ ...data.portfolio_current[0], composition_key: "" }],
  };
  assert.equal(restoreEstimates(legacy).get("a").total, 40000);
});
