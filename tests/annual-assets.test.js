import { test } from "node:test";
import assert from "node:assert/strict";
import { previousYearAssets, FX } from "../public/domain.js";

const accounts = [
  { id: "a", holder_id: "alice" },
  { id: "b", holder_id: "alice" },
  { id: "c", holder_id: "bob" },
];
const event = (id, account_id, date, amount, rate = FX) => ({
  id, account_id, date, amount, rate, kind: "valuation",
  cost_delta: 0, cost_twd_delta: 0,
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
