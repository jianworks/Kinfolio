import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Exercise the shared dialog listeners installed by the application.
function setup() {
  const handlers = new Map();
  const modal = {
    closed: false,
    dataset: {},
    classList: { remove() {} },
    getBoundingClientRect: () => ({ left: 100, right: 600, top: 100, bottom: 600 }),
    close() { this.closed = true; },
    addEventListener(type, handler) { handlers.set(type, handler); },
  };
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf('modal.addEventListener("close"');
  const end = source.indexOf('try {\n  config = await api("config");', start);
  assert.ok(start >= 0 && end > start);
  runInNewContext(source.slice(start, end), { modal });
  const fire = (type, x, y, target = modal) => handlers.get(type)?.({ target, clientX: x, clientY: y, button: 0 });
  return { modal, fire };
}
test("drag selecting from an input to the backdrop keeps the dialog open", () => {
  const { modal, fire } = setup();
  fire("pointerdown", 150, 200, {});
  fire("pointerup", 50, 200);
  fire("click", 50, 200);
  assert.equal(modal.closed, false);
});
test("a genuine backdrop click still closes the dialog", () => {
  const { modal, fire } = setup();
  fire("pointerdown", 50, 200);
  fire("pointerup", 50, 200);
  fire("click", 50, 200);
  assert.equal(modal.closed, true);
});
test("inside clicks and backdrop-to-inside drags keep the dialog open", () => {
  const { modal, fire } = setup();
  fire("pointerdown", 50, 200);
  fire("pointerup", 150, 200, {});
  fire("click", 150, 200);
  assert.equal(modal.closed, false);
  fire("pointerdown", 150, 200, {});
  fire("click", 150, 200, {});
  assert.equal(modal.closed, false);
});
