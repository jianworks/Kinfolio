import test from "node:test";
import assert from "node:assert/strict";
import { mountCashPlan, resetCashDraft } from "../public/cash-plan-ui.js";

function setup(t, save) {
  resetCashDraft();
  t.mock.method(globalThis, "setInterval", () => undefined);
  t.mock.method(globalThis, "clearInterval", () => {});
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  });
  globalThis.document = {
    querySelector: () => ({}),
  };
  const status = {};
  const totals = new Map();
  const root = {
    innerHTML: "",
    querySelector: (selector) => {
      if (selector === "input:invalid") return null;
      if (selector.startsWith("[data-total=")) {
        if (!totals.has(selector)) totals.set(selector, {});
        return totals.get(selector);
      }
      return status;
    },
  };
  const messages = [];
  mountCashPlan({
    root,
    saved: { payload: JSON.stringify({
      start: "2090-01", opening: 0, floor: 0,
      items: [{ name: "薪資", direction: "income", values: Array(12).fill(0) }],
    }) },
    save,
    toast: (message) => messages.push(message),
  });
  return {
    root, status, messages,
    total: (index) => totals.get(`[data-total="${index}"]`).textContent,
    click: (dataset) => root.onclick({ target: { closest: () => ({ dataset }) } }),
    input: (dataset, value) => root.oninput({ target: { dataset, value, setCustomValidity() {} } }),
  };
}

test("完成既有列及新增收支的編輯時儲存輸入內容", async (t) => {
  const saved = [];
  const ui = setup(t, async (plan) => saved.push(structuredClone(plan)));
  await ui.click({ edit: "0" });
  assert.equal(saved.length, 0);
  ui.input({ row: "0", col: "0" }, "123.45");
  await ui.click({ edit: "0" });
  assert.equal(saved[0].items[0].values[0], 12345);
  assert.equal(ui.status.textContent, "已儲存的規劃");
  for (const [index, direction] of [[1, "income"], [2, "expense"]]) {
    await ui.click({ cash: direction });
    ui.input({ name: String(index) }, "新增項目");
    await ui.click({ edit: String(index) });
    assert.equal(saved.at(-1).items[index].direction, direction);
    assert.equal(saved.at(-1).items[index].name, "新增項目");
  }
  assert.equal(saved.length, 3);
});

test("每項全年合計即時加總十二個月，保留小數並將空白視為零", async (t) => {
  const ui = setup(t, async () => {});
  assert.match(ui.root.innerHTML, /全年合計/);
  assert.equal(ui.total(0), "0");
  await ui.click({ edit: "0" });
  ui.input({ row: "0", col: "0" }, "1234.56");
  ui.input({ row: "0", col: "11" }, "0.01");
  assert.equal(ui.total(0), "1,234.57");
  ui.input({ row: "0", col: "11" }, "");
  assert.equal(ui.total(0), "1,234.56");
  await ui.click({ fill: "0" });
  assert.equal(ui.total(0), "14,814.72");
  await ui.click({ edit: "0" });
  assert.equal(ui.total(0), "14,814.72");
  await ui.click({ cash: "expense" });
  assert.equal(ui.total(1), "0");
  ui.input({ row: "1", col: "0" }, "100");
  assert.equal(ui.total(1), "100");
  await ui.click({ remove: "0" });
  assert.equal(ui.total(0), "100");
});

test("儲存期間阻止重複操作，失敗後保留編輯內容並可重試", async (t) => {
  let rejectSave;
  let calls = 0;
  const ui = setup(t, () => {
    calls++;
    return calls === 1 ? new Promise((resolve, reject) => { rejectSave = reject; }) : Promise.resolve();
  });
  await ui.click({ edit: "0" });
  ui.input({ name: "0" }, "更新薪資");
  const pending = ui.click({ edit: "0" });
  await ui.click({ edit: "0" });
  assert.equal(calls, 1);
  rejectSave(new Error("儲存失敗"));
  await pending;
  assert.equal(ui.messages.at(-1), "儲存失敗");
  assert.equal(ui.status.textContent, "有未儲存的變更");
  assert.match(ui.root.innerHTML, /完成編輯 更新薪資/);
  await ui.click({ edit: "0" });
  assert.equal(calls, 2);
  assert.equal(ui.status.textContent, "已儲存的規劃");
});
