import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FX,
  accountState,
  validateTimeline,
  transferPrincipal,
  simpleReturn,
  transferCosts,
} from "../public/domain.js";
test("full transfer retains overall principal and profit while the source principal becomes negative", () => {
  const a = { id: "a", created_date: "2020-01-01" },
    b = { id: "b", created_date: "2020-01-01" };
  const opening = {
    id: 1,
    account_id: "a",
    date: "2020-01-01",
    kind: "opening",
    amount: 3200000,
    cost_delta: 2400000,
    cost_twd_delta: 2400000,
    rate: FX,
  };
  const p = transferPrincipal(accountState(a, [opening]), 3200000, 100000, FX);
  const out = {
    id: 2,
    account_id: "a",
    date: "2020-02-01",
    kind: "transfer_out",
    amount: -3200000,
    cost_delta: -p.local,
    cost_twd_delta: -p.twd,
    rate: FX,
  };
  const into = {
    id: 3,
    account_id: "b",
    date: "2020-02-01",
    kind: "transfer_in",
    amount: 100000,
    cost_delta: p.target,
    cost_twd_delta: p.twd,
    rate: 32 * FX,
  };
  const events = [opening, out, into];
  assert.doesNotThrow(() => validateTimeline(a, events));
  assert.doesNotThrow(() => validateTimeline(b, events));
  const from = accountState(a, events),
    to = accountState(b, events);
  assert.equal(from.value, 0);
  assert.equal(from.cost, -800000);
  assert.equal(to.cost, 100000);
  assert.equal(from.costTwd + to.costTwd, 2400000);
  const profit = from.valueTwd + to.valueTwd - from.costTwd - to.costTwd;
  assert.equal(profit, 800000);
  assert.equal(simpleReturn(from.valueTwd - from.costTwd, from.costTwd), null);
  assert.ok(
    Math.abs(simpleReturn(profit, from.costTwd + to.costTwd) - 100 / 3) < 1e-10,
  );
  assert.equal(simpleReturn(to.valueTwd - to.costTwd, to.costTwd), 0);
});
test("zero and negative principal hide percentages, even with positive profit", () => {
  for (const profit of [-100, 0, 100])
    for (const principal of [0, -100])
      assert.equal(simpleReturn(profit, principal), null);
  assert.equal(simpleReturn(-100, 200), -50);
  assert.equal(simpleReturn(100, 200), 50);
});
test("negative principal does not bypass cash or history validation", () => {
  assert.throws(() =>
    transferPrincipal({ value: 100, cost: -500 }, 101, 100, FX),
  );
  assert.deepEqual(transferPrincipal({ value: 100, cost: -500 }, 100, 3, FX), {
    local: 100,
    target: 3,
    twd: 100,
  });
  const a = { id: "a", created_date: "2020-01-01" };
  assert.throws(() =>
    validateTimeline(a, [
      {
        id: 1,
        account_id: "a",
        date: "2020-01-01",
        kind: "withdrawal",
        amount: -1,
        cost_delta: -10,
        cost_twd_delta: -10,
      },
    ]),
  );
  assert.deepEqual(
    transferCosts({ value: 100, cost: -500, costTwd: -500 }, 100),
    { local: 0, twd: 0 },
  );
});
