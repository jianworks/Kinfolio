import test from "node:test";
import assert from "node:assert/strict";
import { themes, readTheme } from "../public/themes.js";

test("theme preferences are restored from the selected account key", () => {
  const values = new Map([
    ["kinfolio-theme:one", "midnight"],
    ["kinfolio-theme:two", "coast"],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.equal(readTheme(storage, "kinfolio-theme:one").id, "midnight");
  assert.equal(readTheme(storage, "kinfolio-theme:two").id, "coast");
  assert.equal(readTheme(storage, "kinfolio-theme:other").id, "original");
});
test("unknown or unavailable theme storage keeps the original palette", () => {
  assert.equal(
    readTheme({ getItem: () => "<script>invalid</script>" }, "theme").id,
    "original",
  );
  assert.equal(
    readTheme(
      {
        getItem: () => {
          throw Error("Blocked");
        },
      },
      "theme",
    ).id,
    "original",
  );
});
test("every palette has readable main text and action buttons", () => {
  const luminance = (hex) => {
    const c = [1, 3, 5].map((i) => {
      const s = parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const ratio = (a, b) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const t of themes) {
    assert.ok(ratio(t.ink, t.page) >= 4.5, t.id + " page text");
    assert.ok(ratio(t.ink, t.surface) >= 4.5, t.id + " surface text");
    assert.ok(
      ratio(t.dark ? "#122d2a" : "#ffffff", t.accent) >= 4.5,
      t.id + " button text",
    );
  }
});
