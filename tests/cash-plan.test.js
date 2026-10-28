import test from "node:test";
import assert from "node:assert/strict";
import {
  rollPlan,
  forecast,
  monthsFrom,
  validatePlan,
} from "../public/cash-plan-domain.js";
const plan = () => ({
  start: "2026-11",
  opening: 10000000,
  floor: 3000000,
  items: [
    {
      name: "支出",
      direction: "expense",
      values: [8000000, 0, 1000000, ...Array(9).fill(0)],
    },
    {
      name: "收入",
      direction: "income",
      values: [0, 10000000, ...Array(10).fill(0)],
    },
  ],
});
test("保留額涵蓋中途缺口，期末有餘仍需補足", () => {
  const r = forecast(plan());
  assert.equal(r.required, 11000000);
  assert.equal(r.shortfall, 1000000);
  assert.equal(r.firstLow, "2026-11");
  assert.equal(r.rows[2].balance, 11000000);
});
test("跨年與既有空白月份自動補零", () => {
  assert.equal(monthsFrom("2026-11")[2], "2027-01");
  const p = plan();
  p.items[0].values[1] = null;
  const r = forecast(p);
  assert.equal(r.complete, true);
  assert.equal(r.required, 11000000);
  assert.equal(r.rows[0].balance, 2000000);
  assert.equal(r.rows[1].balance, 12000000);
  assert.equal(validatePlan(p).items[0].values[1], 0);
});
test("零、全正流量、取整與空計畫", () => {
  const p = plan();
  p.items = [];
  assert.equal(forecast(p).complete, false);
  p.items = [{ name: "收入", direction: "income", values: Array(12).fill(0) }];
  p.floor = 3000001;
  assert.equal(forecast(p).required, 4000000);
  assert.equal(forecast(p).available, 6000000);
});
test("拒絕錯誤月份、負值、非整數與超出範圍", () => {
  for (const start of ["2026-13", "x", "9999-12"])
    assert.throws(() => monthsFrom(start));
  for (const opening of [-1, 1.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => validatePlan({ ...plan(), opening }));
  assert.throws(() =>
    validatePlan({
      ...plan(),
      items: [{ name: "", direction: "expense", values: Array(12).fill(0) }],
    }),
  );
});

test('每月滾動保留原月份，去年同月複製到下一年，不改原資料',()=>{
 const p=plan();p.start='2026-10';p.items[0].values=Array.from({length:12},(_,i)=>(i+1)*100);
 const r=rollPlan(p,'2026-11');
 assert.deepEqual(r.items[0].values,[200,300,400,500,600,700,800,900,1000,1100,1200,100]);
 assert.equal(monthsFrom(r.start)[11],'2027-10');assert.equal(p.items[0].values[0],100);
 assert.equal(r.openingMonth,'2026-10');assert.equal(r.opening,p.opening);
 assert.deepEqual(rollPlan(r,'2026-11'),r);
 assert.deepEqual(rollPlan(p,'2027-01').items[0].values,[400,500,600,700,800,900,1000,1100,1200,100,200,300]);
 assert.deepEqual(rollPlan(p,'2028-11').items[0].values,r.items[0].values);
 assert.throws(()=>rollPlan(p,'2026-09'));
});
