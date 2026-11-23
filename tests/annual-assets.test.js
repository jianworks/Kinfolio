import { test } from "node:test";
import assert from "node:assert/strict";
import { previousYearAssets, annualProfit, FX } from "../public/domain.js";

const accounts = [
  { id: "a", holder_id: "alice" },
  { id: "b", holder_id: "alice" },
  { id: "c", holder_id: "bob" },
];
const event = (id, account_id, date, amount, rate = FX) => ({
  id, account_id, date, amount, rate, kind: "valuation",
  cost_delta: 0, cost_twd_delta: 0,
});

test("annual profit excludes deposits, withdrawals and new account principal", () => {
  const history = [
    { ...event(1, "a", "2025-12-20", 10000), cost_twd_delta: 8000 },
    { ...event(2, "a", "2026-01-02", 5000), kind: "deposit", cost_twd_delta: 5000 },
    { ...event(3, "a", "2026-02-02", -2000), kind: "withdrawal", cost_twd_delta: -2000 },
    { ...event(4, "b", "2026-03-02", 4000), kind: "opening", cost_twd_delta: 4000 },
  ];
  assert.equal(annualProfit(accounts, history, "2026-11-23", 17000, "alice").profit, 0);
  assert.equal(annualProfit(accounts, history, "2026-11-23", 18500, "alice").profit, 1500);
  assert.equal(annualProfit(accounts, history, "2026-11-23", 16000, "alice").profit, -1000);
  assert.equal(annualProfit(accounts, history, "2026-01-01", 10000, "alice").profit, 0);
  assert.equal(annualProfit(accounts, history, "2026-11-23", 0, "bob"), null);
});

test("internal transfers cancel and cross-holder transfers are excluded from profit", () => {
  const history = [
    event(1, "a", "2025-12-31", 10000),
    { ...event(2, "a", "2026-01-02", -3000), kind: "transfer_out", cost_twd_delta: -3000 },
    { ...event(3, "b", "2026-01-02", 3000), kind: "transfer_in", cost_twd_delta: 3000 },
    { ...event(4, "a", "2026-02-02", -2000), kind: "transfer_out", cost_twd_delta: -2000 },
    { ...event(5, "c", "2026-02-02", 2000), kind: "transfer_in", cost_twd_delta: 2000 },
  ];
  assert.equal(annualProfit(accounts, history, "2026-11-23", 8000, "alice").profit, 0);
  assert.equal(annualProfit(accounts, history, "2026-11-23", 10000).profit, 0);
});
const events = [
  event(1, "b", "2024-12-31", 200),
  event(2, "a", "2025-11-30", 100, 30 * FX),
  event(3, "a", "2025-12-20", 150, 32 * FX),
  event(4, "a", "2025-12-20", 160, 32 * FX),
  event(5, "c", "2025-12-31", 900),
  event(6, "a", "2026-02-01", 500),
];

test("last prior-year record respects holder, FX, same-day order and carried balances", () => {
  assert.deepEqual(previousYearAssets(accounts, events, "2026-11-19", "alice"), {
    date: "2025-12-20", value: 5320,
  });
  assert.deepEqual(previousYearAssets(accounts, events, "2026-11-19"), {
    date: "2025-12-31", value: 6220,
  });
});

test("historical view uses its own prior year and missing prior-year records stay unavailable", () => {
  assert.deepEqual(previousYearAssets(accounts, events, "2025-06-01", "alice"), {
    date: "2024-12-31", value: 200,
  });
  assert.equal(previousYearAssets(accounts, events, "2027-01-01", "bob"), null);
  assert.equal(previousYearAssets(accounts, [], "2026-11-19"), null);
});
