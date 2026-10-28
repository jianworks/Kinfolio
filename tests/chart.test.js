import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function renderDates(days) {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const chart = source.slice(source.indexOf("function chart()"), source.indexOf("function allocation()"));
  return runInNewContext(`${chart}; chart()`, {
    state: { accounts: [{ id: "a", holder_id: "h" }], events: days.map((date) => ({ account_id: "a", date })) },
    holder: "h", asOf: days.at(-1), totals: () => ({ value: 884300000, cost: 400000000 }), fmt: String,
  });
}

test("trend points use elapsed calendar time rather than observation order", () => {
  const days = ["2015-12-31", "2022-02-05", "2026-10-26"];
  const html = renderDates(days);
  const xs = [...html.matchAll(/<circle cx="([^"]+)"/g)].map((m) => Number(m[1]));
  const expected = (Date.parse(days[1]) - Date.parse(days[0])) / (Date.parse(days[2]) - Date.parse(days[0]));
  assert.ok(Math.abs((xs[1] - xs[0]) / (xs[2] - xs[0]) - expected) < 1e-10);
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
    holder: "h", asOf: "2026-10-26", totals: () => ({ value: 884300000, cost: 400000000 }), fmt: String,
  });
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.doesNotMatch(svg, /<text\b/, "SVG scaling must not stretch axis text");
  assert.match(html, /chart-axis-y/);
  assert.match(html, /chart-axis-x/);
  assert.match(html, /884\.3萬/);
  assert.match(html, /2026-10-26/);
});
