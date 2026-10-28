import { FX, today } from "../public/domain.js";
export function parseExchangeRate(
  currency,
  data,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    data?.result !== "success" ||
    data.base_code !== currency ||
    !Number.isFinite(data.rates?.TWD) ||
    data.rates.TWD <= 0 ||
    !Number.isSafeInteger(data.time_last_update_unix) ||
    data.time_last_update_unix <= 0 ||
    data.time_last_update_unix > now + 300
  )
    throw Error("匯率資料無效");
  const rate = Math.round(data.rates.TWD * FX);
  if (!Number.isSafeInteger(rate) || rate <= 0) throw Error("匯率資料無效");
  const date = new Date(data.time_last_update_unix * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    rate,
    date,
    source: "ExchangeRate-API（每日參考匯率）",
    warning:
      Date.parse(today()) - Date.parse(date) > 4 * 86400000
        ? "匯率日期較舊，請確認後再儲存"
        : null,
  };
}
export function createExchangeRateService({
  fetchData = async (currency) => {
    const r = await fetch("https://open.er-api.com/v6/latest/" + currency, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw Error("匯率連線失敗");
    return r.json();
  },
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async (env, currency) => {
    if (currency === "TWD")
      return { rate: FX, date: null, source: null, warning: null };
    if (!["USD", "JPY"].includes(currency)) throw Error("不支援的匯率幣別");
    const db = env.DB,
      now = clock();
    const old = await db
      .prepare("SELECT * FROM quote_cache WHERE market='FX' AND symbol=?")
      .bind(currency)
      .first();
    const cached = () => ({
      rate: old?.price || null,
      date: old?.price_date || null,
      source: old?.source || null,
      warning: old?.error || null,
    });
    if (old?.price && old.fetched_at > now - 3600) return cached();
    if (old?.last_attempt > now - 600)
      return { ...cached(), warning: old.error || "匯率更新中，沿用最近匯率" };
    await db
      .prepare(
        "INSERT OR IGNORE INTO quote_cache(market,symbol) VALUES('FX',?)",
      )
      .bind(currency)
      .run();
    const reserved = await db
      .prepare(
        "UPDATE quote_cache SET last_attempt=? WHERE market='FX' AND symbol=? AND last_attempt<=? RETURNING symbol",
      )
      .bind(now, currency, now - 600)
      .first();
    if (!reserved) return { ...cached(), warning: "匯率更新中，沿用最近匯率" };
    try {
      const q = parseExchangeRate(currency, await fetchData(currency), now);
      await db
        .prepare(
          "UPDATE quote_cache SET price=?,price_date=?,source=?,fetched_at=?,error=? WHERE market='FX' AND symbol=?",
        )
        .bind(q.rate, q.date, q.source, now, q.warning || "", currency)
        .run();
      return q;
    } catch {
      const warning = "匯率暫時無法更新，沿用最近匯率";
      await db
        .prepare(
          "UPDATE quote_cache SET error=? WHERE market='FX' AND symbol=?",
        )
        .bind(warning, currency)
        .run();
      return { ...cached(), warning };
    }
  };
}
export const getExchangeRate = createExchangeRateService();
