import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { restoreEstimates } from "../public/estimate-state.js";

test("futures polling updates totals and the open detail while retaining stock estimates", async () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const polling = source.slice(source.indexOf("let futuresLoading = false"), source.indexOf("setInterval(refreshFutures"));
  const stocks = { total: 500, source: "stocks" };
  const liveEstimates = new Map([["stocks", stocks], ["f", { source: "futures", total: 100 }]]);
  let amount = 200, requests = 0, renders = 0, details = 0;
  const context = {
    state: { accounts: [{ id: "f", type: "期貨", currency: "TWD" }] },
    document: { hidden: false }, asOf: "2026-11-12", today: () => "2026-11-12",
    busy: false, estimateEpoch: 1, liveEstimates, restoreEstimates,
    api: async (path) => {
      assert.equal(path, "futures-current");
      requests++;
      return { futures_current: [{
        account_id: "f", amount, rate: 1000000, data_date: "2026-11-12",
        sync_id: String(amount),
      }] };
    },
    render: () => renders++,
    modal: { open: true, dataset: { detailAccount: "f" } },
    detail: (id) => { assert.equal(id, "f"); details++; },
  };
  const poll = runInNewContext(`${polling}; refreshFutures`, context);
  await poll();
  assert.equal(liveEstimates.get("f").total, 200);
  amount = 300;
  await poll();
  assert.equal(liveEstimates.get("f").total, 300);
  assert.equal(liveEstimates.get("stocks"), stocks);
  assert.equal(renders, 2);
  assert.equal(details, 2);
  context.document.hidden = true;
  await poll();
  assert.equal(requests, 2);
  context.document.hidden = false;
  context.api = async () => { throw Error("offline"); };
  await poll();
  assert.equal(liveEstimates.get("f").total, 300);
});
