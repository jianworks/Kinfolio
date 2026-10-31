import { monthlyTrendDates } from "../public/chart-dates.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function renderDates(days) {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const chart = source.slice(source.indexOf("function chart()"), source.indexOf("function allocation()"));
  return runInNewContext(`${chart}; chart()`, {
    state: { accounts: [{ id: "a", holder_id: "h" }], events: days.map((date) => ({ account_id: "a", date })) },
    monthlyTrendDates, holder: "h", asOf: days.at(-1), totals: () => ({ value: 884300000, cost: 400000000 }), fmt: String,
  });
}

test("trend points use elapsed calendar time rather than observation order", () => {
  const days = ["2015-12-31", "2022-02-05", "2026-10-26"];
  const html = renderDates(days);
  const xs = [...html.matchAll(/<circle cx="([^"]+)"/g)].map((m) => Number(m[1]));
  const sampled = monthlyTrendDates(days[0], days.at(-1));
  assert.equal(xs.length, sampled.length);
  for (let i = 0; i < xs.length; i++) {
    const expected = (Date.parse(sampled[i]) - Date.parse(sampled[0])) / (Date.parse(sampled.at(-1)) - Date.parse(sampled[0]));
    assert.ok(Math.abs((xs[i] - xs[0]) / (xs.at(-1) - xs[0]) - expected) < 1e-10);
  }
});

test("a single valuation has finite chart coordinates", () => {
  const html = renderDates(["2026-10-26"]);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.equal([...html.matchAll(/class="chart-axis-x"/g)].length, 1);
});

test("trend axis labels stay outside the stretched SVG", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const chart = source.slice(source.indexOf("function chart()"), source.indexOf("function allocation()"));
  const html = runInNewContext(`${chart}; chart()`, {
    state: { accounts: [{ id: "a", holder_id: "h" }], events: [{ account_id: "a", date: "2020-01-01" }] },
    monthlyTrendDates, holder: "h", asOf: "2026-10-26", totals: () => ({ value: 884300000, cost: 400000000 }), fmt: String,
  });
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.doesNotMatch(svg, /<text\b/, "SVG scaling must not stretch axis text");
  assert.match(html, /chart-axis-y/);
  assert.match(html, /chart-axis-x/);
  assert.match(html, /884\.3萬/);
  assert.match(html, /2026-10-26/);
});


test("monthly trend dates include missing months and cross years", () => {
  assert.deepEqual(monthlyTrendDates("2025-11-12", "2026-02-15"), ["2025-11-30", "2025-12-31", "2026-01-31", "2026-02-15"]);
});
test("month ends handle leap years and never duplicate the inspection date", () => {
  assert.deepEqual(monthlyTrendDates("2024-01-31", "2024-03-31"), ["2024-01-31", "2024-02-29", "2024-03-31"]);
  assert.deepEqual(monthlyTrendDates("2025-02-01", "2025-03-01"), ["2025-02-28", "2025-03-01"]);
});
test("new histories have just the inspection date and no future points", () => {
  assert.deepEqual(monthlyTrendDates("2026-10-02", "2026-10-15"), ["2026-10-15"]);
  assert.deepEqual(monthlyTrendDates("2026-10-31", "2026-10-31"), ["2026-10-31"]);
  assert.deepEqual(monthlyTrendDates(null, "2026-10-31"), []);
  assert.deepEqual(monthlyTrendDates("2026-11-01", "2026-10-31"), []);
});
test("long histories retain every month instead of sampling 24 records", () => {
  assert.equal(monthlyTrendDates("2020-01-01", "2026-10-15").length, 82);
});
