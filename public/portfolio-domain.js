import { requireThat, toTwd } from "./domain.js";
export const SCALE = 1000000;
export function decimal(value, label, positive = true) {
  let str = String(value ?? "").trim();
  if (str.startsWith(".")) str = "0" + str;
  requireThat(
    /^\d+(\.\d{1,6})?$/.test(str),
    `${label}請填非負數，最多六位小數`,
  );
  const [whole, fraction = ""] = str.split("."),
    n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  requireThat(
    n <= 1000000000000000n && (!positive || n > 0n),
    `${label}超出範圍或必須大於零`,
  );
  return Number(n);
}
export function symbolFor(market, value) {
  const symbol = String(value ?? "")
    .trim()
    .toUpperCase();
  requireThat(["TWSE", "TPEX", "US"].includes(market), "請選擇交易市場");
  requireThat(
    market === "US"
      ? /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)
      : /^\d{4,6}[A-Z]?$/.test(symbol),
    "股票代號格式錯誤",
  );
  return symbol;
}
export function positionValue(quantity, price) {
  requireThat(
    Number.isSafeInteger(quantity) &&
      quantity > 0 &&
      Number.isSafeInteger(price) &&
      price > 0,
    "股數或價格無效",
  );
  const divisor = 1000000000000n,
    value = Number(
      (BigInt(quantity) * BigInt(price) * 100n + divisor / 2n) / divisor,
    );
  requireThat(Number.isSafeInteger(value), "持股市值超出精確計算範圍");
  return value;
}
export function portfolioValue(cash, rate, positions) {
  requireThat(Number.isSafeInteger(cash) && cash >= 0, "現金餘額格式錯誤");
  let total = cash,
    complete = true;
  const holdings = positions.map((h) => {
    if (!Number.isSafeInteger(h.price) || h.price <= 0) {
      complete = false;
      return { ...h, value: null };
    }
    const value = positionValue(h.quantity, h.price);
    total += value;
    requireThat(Number.isSafeInteger(total), "帳戶總值超出精確計算範圍");
    return { ...h, value };
  });
  return {
    cash,
    rate,
    holdings,
    complete,
    total: complete ? total : null,
    totalTwd: complete ? toTwd(total, rate) : null,
  };
}
