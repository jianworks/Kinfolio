import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  rate,
  date,
  FX,
  accountState,
  validateTimeline,
  transferCosts,
  toTwd,
} from "../public/domain.js";
const a = { id: "a", currency: "USD", created_date: "2020-01-01" };
const opening = {
  id: 1,
  account_id: "a",
  date: "2020-01-01",
  kind: "opening",
  amount: 150000,
  cost_delta: 100000,
  cost_twd_delta: 3000000,
  rate: 30 * FX,
};
test("valuation changes market value and FX without rewriting cost", () => {
  const s = accountState(a, [
    opening,
    {
      id: 2,
      account_id: "a",
      date: "2020-02-01",
      kind: "valuation",
      amount: 170000,
      cost_delta: 0,
      cost_twd_delta: 0,
      rate: 32 * FX,
    },
  ]);
  assert.equal(s.cost, 100000);
  assert.equal(s.costTwd, 3000000);
  assert.equal(s.valueTwd, 5440000);
  assert.equal(accountState(a, [opening], "2019-12-31").value, 0);
});
test("cross currency transfer preserves combined historical TWD cost", () => {
  const source = accountState(a, [opening]),
    c = transferCosts(source, 20000);
  assert.deepEqual(c, { local: 20000, twd: 600000 });
  const out = {
    id: 2,
    account_id: "a",
    date: "2020-02-01",
    kind: "transfer_out",
    amount: -20000,
    cost_delta: -c.local,
    cost_twd_delta: -c.twd,
    rate: 32 * FX,
  };
  const b = { id: "b", currency: "JPY", created_date: "2020-01-01" };
  const into = {
    ...out,
    account_id: "b",
    kind: "transfer_in",
    amount: 1000000,
    cost_delta: 1000000,
    cost_twd_delta: c.twd,
    rate: 640000,
  };
  assert.equal(
    accountState(a, [opening, out]).costTwd + accountState(b, [into]).costTwd,
    source.costTwd,
  );
  assert.equal(accountState(a, [opening, out]).value, 130000);
});
test("profit-only withdrawal leaves principal intact", () =>
  assert.deepEqual(transferCosts(accountState(a, [opening]), 10000, 0), {
    local: 0,
    twd: 0,
  }));
test("zero and overdraw handling", () => {
  assert.equal(money(0), 0);
  assert.throws(() => money("", undefined));
  assert.throws(() => money(-1));
  assert.throws(() => money(0, "value", true));
  assert.throws(() => money(1.001));
  assert.throws(() => rate(0, "USD"));
  assert.throws(() => transferCosts(accountState(a, [opening]), 150001));
  assert.throws(() => transferCosts(accountState(a, [opening]), 10000, 1001));
  assert.deepEqual(transferCosts({ value: 100, cost: 0, costTwd: 0 }, 100), {
    local: 0,
    twd: 0,
  });
});
test("backdated transactions cannot overdraw later balances", () => {
  const events = [
    opening,
    {
      ...opening,
      id: 3,
      date: "2020-03-01",
      kind: "withdrawal",
      amount: -140000,
      cost_delta: -90000,
      cost_twd_delta: -2700000,
    },
  ];
  assert.doesNotThrow(() => validateTimeline(a, events));
  assert.throws(() =>
    validateTimeline(a, [
      ...events,
      {
        ...opening,
        id: 2,
        date: "2020-02-01",
        kind: "withdrawal",
        amount: -20000,
        cost_delta: 0,
        cost_twd_delta: 0,
      },
    ]),
  );
  assert.throws(() =>
    validateTimeline(a, [{ ...opening, date: "2019-12-31" }]),
  );
});
test("same-day records follow insertion order", () => {
  const v = {
    ...opening,
    id: 2,
    kind: "valuation",
    amount: 200000,
    cost_delta: 0,
    cost_twd_delta: 0,
  };
  const w = { ...v, id: 3, kind: "withdrawal", amount: -10000 };
  assert.equal(accountState(a, [w, opening, v]).value, 190000);
});
test("calendar validation rejects impossible and future dates", () => {
  assert.throws(() => date("2025-02-29"));
  assert.throws(() => date("2100-01-01"));
  assert.equal(date("2024-02-29"), "2024-02-29");
  assert.equal(date("2100-01-01", true), "2100-01-01");
});
test("large currency conversions use exact integer arithmetic", () => {
  assert.equal(toTwd(100000000000001, 1234567), 123456700000001);
  assert.equal(toTwd(-101, 500000), -51);
  assert.throws(() => toTwd(Number.MAX_SAFE_INTEGER, 2 * FX));
});
