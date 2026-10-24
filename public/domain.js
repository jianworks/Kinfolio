// Money uses integer hundredths; FX uses integer millionths of TWD per currency unit.
export const MONEY = 100;
export const FX = 1000000;
export class InputError extends Error {}
export function requireThat(condition, message) {
  if (!condition) throw new InputError(message);
}
export function text(value, label, max = 120) {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label}為必填，最多 ${max} 字`,
  );
  return value.trim();
}
export function money(value, label = "金額", positive = false) {
  requireThat(
    value !== "" &&
      value !== null &&
      value !== undefined &&
      typeof value !== "boolean",
    `${label}格式錯誤`,
  );
  const n = Number(value);
  requireThat(
    Number.isFinite(n) && n >= 0 && (!positive || n > 0) && n <= 1e12,
    `${label}必須${positive ? "大於零" : "為非負數"}且不超過一兆`,
  );
  const result = Math.round(n * MONEY);
  requireThat(Math.abs(n * MONEY - result) < 0.0001, `${label}最多兩位小數`);
  return result;
}
export function rate(value, currency) {
  if (currency === "TWD") return FX;
  const n = Number(value);
  requireThat(
    Number.isFinite(n) && n > 0 && n <= 100000,
    "請輸入有效匯率（1 單位外幣等於多少台幣）",
  );
  const result = Math.round(n * FX);
  requireThat(
    result > 0 && Math.abs(n * FX - result) < 0.0001,
    "匯率最多六位小數",
  );
  return result;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function date(value, allowFuture = false) {
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "日期格式錯誤",
  );
  requireThat(allowFuture || value <= today(), "記錄日期不能晚於今天");
  return value;
}
export function toTwd(amount, fx) {
  requireThat(
    Number.isSafeInteger(amount) && Number.isSafeInteger(fx),
    "金額超出精確計算範圍",
  );
  const product = BigInt(amount) * BigInt(fx),
    divisor = BigInt(FX);
  const v = Number(
    product >= 0n
      ? (product + divisor / 2n) / divisor
      : -((-product + divisor / 2n) / divisor),
  );
  requireThat(Number.isSafeInteger(v), "金額超出精確計算範圍");
  return v;
}
export function accountState(account, events, asOf = "9999-12-31") {
  let value = 0,
    cost = 0,
    costTwd = 0,
    fx = FX,
    lastDate = null;
  for (const e of [...events]
    .filter((e) => e.account_id === account.id && e.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    value =
      e.kind === "valuation" || e.kind === "opening"
        ? e.amount
        : value + e.amount;
    cost += e.cost_delta;
    costTwd += e.cost_twd_delta;
    fx = e.rate;
    lastDate = e.date;
  }
  return {
    ...account,
    value,
    cost,
    costTwd,
    rate: fx,
    lastDate,
    valueTwd: toTwd(value, fx),
  };
}
export function validateTimeline(account, events) {
  let v = 0,
    c = 0,
    t = 0;
  for (const e of [...events]
    .filter((e) => e.account_id === account.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    requireThat(e.date >= account.created_date, "記錄不能早於開戶日期");
    v = ["opening", "valuation"].includes(e.kind) ? e.amount : v + e.amount;
    c += e.cost_delta;
    t += e.cost_twd_delta;
    requireThat(
      [v, c, t].every(Number.isSafeInteger),
      "累計金額超出精確計算範圍",
    );
    requireThat(
      v >= 0 && c >= 0 && t >= 0,
      "此異動會使當日或後續的帳戶價值／本金小於零",
    );
  }
}
export function transferCosts(source, amount, requested) {
  const local =
    requested === undefined
      ? Math.min(amount, source.cost)
      : money(requested, "移轉本金");
  requireThat(amount > 0 && amount <= source.value, "轉出金額超過帳戶價值");
  requireThat(local <= source.cost, "移轉本金超過剩餘本金");
  // Preserve historical TWD cost across currencies, independently of current FX.
  const twd =
    source.cost === 0
      ? 0
      : Number(
          (BigInt(source.costTwd) * BigInt(local) + BigInt(source.cost) / 2n) /
            BigInt(source.cost),
        );
  return { local, twd };
}
