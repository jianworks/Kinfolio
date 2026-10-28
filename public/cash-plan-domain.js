import { requireThat, text } from "./domain.js";

export function monthsFrom(start) {
  requireThat(
    typeof start === "string" &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(start) &&
      +start.slice(0, 4) >= 1900 &&
      +start.slice(0, 4) <= 9998,
    "請輸入有效起始月份",
  );
  const [year, month] = start.split("-").map(Number);
  return Array.from(
    { length: 12 },
    (_, i) =>
      `${year + Math.floor((month - 1 + i) / 12)}-${String(((month - 1 + i) % 12) + 1).padStart(2, "0")}`,
  );
}
function amount(n) {
  requireThat(
    Number.isSafeInteger(n) && n >= 0 && n <= 100000000000000,
    "金額必須為有效非負數，最多一兆元",
  );
  return n;
}
export function validatePlan(p) {
  requireThat(p && typeof p === "object", "規劃格式錯誤");
  monthsFrom(p.start);
  requireThat(
    Array.isArray(p.items) && p.items.length <= 30,
    "最多 30 個收支項目",
  );
  if (p.openingMonth !== undefined) monthsFrom(p.openingMonth);
  return {
    start: p.start,
    opening: amount(p.opening),
    openingMonth: p.openingMonth || p.start,
    floor: amount(p.floor),
    items: p.items.map((item) => {
      requireThat(
        ["income", "expense"].includes(item.direction),
        "收支方向錯誤",
      );
      requireThat(
        Array.isArray(item.values) && item.values.length === 12,
        "每個項目須有 12 個月份",
      );
      return {
        name: text(item.name, "項目名稱", 40),
        direction: item.direction,
        values: item.values.map((v) => (v === null ? 0 : amount(v))),
      };
    }),
  };
}
export function forecast(input) {
  const p = validatePlan(input),
    months = monthsFrom(p.start);
  let balance = p.opening,
    cumulative = 0,
    required = p.floor,
    complete = true;
  const rows = months.map((month, i) => {
    const income = p.items
      .filter((x) => x.direction === "income")
      .reduce((s, x) => s + (x.values[i] ?? 0), 0);
    const expense = p.items
      .filter((x) => x.direction === "expense")
      .reduce((s, x) => s + (x.values[i] ?? 0), 0);
    complete =
      complete &&
      p.items.length > 0 &&
      p.items.every((x) => x.values[i] !== null);
    cumulative += income - expense;
    balance += income - expense;
    requireThat(
      [income, expense, cumulative, balance, p.floor - cumulative].every(
        Number.isSafeInteger,
      ),
      "合計金額超出可計算範圍",
    );
    required = Math.max(required, p.floor - cumulative);
    return {
      month,
      income,
      expense,
      net: income - expense,
      balance: complete ? balance : null,
    };
  });
  required = Math.ceil(required / 1000000) * 1000000;
  return {
    rows,
    complete,
    required: complete ? required : null,
    available: complete ? Math.max(0, p.opening - required) : null,
    shortfall: complete ? Math.max(0, required - p.opening) : null,
    firstLow:
      rows.find((r) => r.balance !== null && r.balance < p.floor)?.month ||
      null,
  };
}

// Rotate values with their calendar month; never relabel the same array in place.
export function rollPlan(input, target) {
  const p = validatePlan(input);
  monthsFrom(target);
  const serial = value => Number(value.slice(0,4))*12 + Number(value.slice(5))-1;
  const offset = serial(target)-serial(p.start);
  requireThat(offset >= 0, '規劃月份不可往回移，請選擇目前或之後的月份');
  return {...p, start:target, items:p.items.map(item=>({...item,values:item.values.map((_,i)=>item.values[(i+offset)%12])}))};
}
