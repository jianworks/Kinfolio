import { requireThat, today } from "./domain.js";
import { symbolFor } from "../public/portfolio-domain.js";
import { analyzeBase, priceDistances } from "../public/watchlist-domain.js";
import { getQuote, getStockName } from "./market-data.js";
export async function watchStatements(
  db,
  u,
  b,
  rows,
  env = {},
  nameFor = getStockName,
) {
  if (b.remove) {
    requireThat(
      rows.some((x) => x.id === b.id),
      "追蹤股票不存在或無權存取",
    );
    return [
      db
        .prepare("DELETE FROM watchlist WHERE id=? AND user_id=?")
        .bind(b.id, u.id),
    ];
  }
  requireThat(rows.length < 100, "最多追蹤 100 檔股票");
  requireThat(
    ["TWSE", "TPEX"].includes(b.market),
    "股票追蹤目前支援台股上市與上櫃",
  );
  const symbol = symbolFor(b.market, b.symbol);
  requireThat(
    !rows.some((x) => x.market === b.market && x.symbol === symbol),
    "這檔股票已在追蹤清單",
  );
  let name;
  try {
    name = await nameFor({ ...env, DB: db }, b.market, symbol);
  } catch {
    requireThat(false, "無法取得股票名稱，請確認市場與代號，或稍後再試");
  }
  return [
    db
      .prepare(
        "INSERT INTO watchlist(id,user_id,market,symbol,name,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        u.id,
        b.market,
        symbol,
        name,
        new Date().toISOString(),
      ),
  ];
}
export function completedDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const day = `${v.year}-${v.month}-${v.day}`;
  return +v.hour >= 16
    ? day
    : new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
}
export function parseHistory(data, market, symbol, end, allowEmpty = false) {
  requireThat(
    data?.symbol === symbol &&
      data.exchange === (market === "TWSE" ? "TWSE" : "TPEx") &&
      Array.isArray(data.data) &&
      data.data.length <= 400,
    "歷史行情商品不符",
  );
  const seen = new Set();
  const bars = data.data
    .filter((x) => x.date <= end)
    .map((x) => {
      requireThat(
        /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
          !isNaN(Date.parse(x.date)) &&
          new Date(x.date).toISOString().slice(0, 10) === x.date &&
          !seen.has(x.date) &&
          [x.low, x.high, x.close].every((v) => Number.isFinite(v) && v > 0) &&
          x.low <= x.close &&
          x.close <= x.high,
        "歷史行情格式錯誤",
      );
      seen.add(x.date);
      return { date: x.date, low: x.low, high: x.high, close: x.close };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  requireThat(allowEmpty || bars.length > 0, "沒有歷史行情");
  return bars;
}
export async function refreshHistory(env, market, symbol, fetcher = fetch) {
  const end = completedDay(),
    target = "range252:" + end,
    now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO stock_history(market,symbol) VALUES(?,?)",
  )
    .bind(market, symbol)
    .run();
  const reserved = await env.DB.prepare(
    "UPDATE stock_history SET last_attempt=? WHERE market=? AND symbol=? AND last_attempt<? AND (target_date IS NULL OR target_date<>?) RETURNING symbol",
  )
    .bind(now, market, symbol, now - 600, target)
    .first();
  if (!reserved) return;
  try {
    if (!env.FUGLE_API_KEY)
      throw Error("尚未設定富果密鑰；股價可更新，型態分析需啟用還原日線來源");
    const dayBefore = (day) =>
      new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    const split = new Date(Date.parse(end) - 225 * 86400000)
      .toISOString()
      .slice(0, 10);
    const from = new Date(Date.parse(end) - 450 * 86400000)
      .toISOString()
      .slice(0, 10);
    const bars = [];
    // Each provider query must span less than one year.
    for (const [start, stop] of [
      [from, dayBefore(split)],
      [split, end],
    ]) {
      const url =
        "https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/" +
        encodeURIComponent(symbol) +
        "?" +
        new URLSearchParams({
          from: start,
          to: stop,
          timeframe: "D",
          adjusted: "true",
          fields: "high,low,close",
        });
      const r = await fetcher(url, {
        headers: { "X-API-KEY": env.FUGLE_API_KEY },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok)
        throw Error("還原日線來源暫時無法更新，請確認富果方案權限或稍後再試");
      bars.push(...parseHistory(await r.json(), market, symbol, stop, true));
    }
    requireThat(bars.length > 0, "沒有歷史行情");
    bars.sort((a, b) => a.date.localeCompare(b.date));
    requireThat(
      new Set(bars.map((b) => b.date)).size === bars.length,
      "歷史行情日期重複",
    );
    await env.DB.prepare(
      "UPDATE stock_history SET payload=?,target_date=?,error='' WHERE market=? AND symbol=?",
    )
      .bind(JSON.stringify(bars), target, market, symbol)
      .run();
  } catch (e) {
    const message =
      e.message.startsWith("尚未設定") || e.message.startsWith("還原日線")
        ? e.message
        : "還原日線更新失敗，保留最近資料";
    await env.DB.prepare(
      "UPDATE stock_history SET error=? WHERE market=? AND symbol=?",
    )
      .bind(message, market, symbol)
      .run();
  }
}
export async function watchRows(env, u) {
  const rows = (
    await env.DB.prepare(
      "SELECT w.*,q.price,q.price_date,q.source,q.error AS quote_error,h.payload,h.error AS history_error FROM watchlist w LEFT JOIN quote_cache q ON q.market=w.market AND q.symbol=w.symbol LEFT JOIN stock_history h ON h.market=w.market AND h.symbol=w.symbol WHERE w.user_id=? ORDER BY w.created_at,w.id",
    )
      .bind(u.id)
      .all()
  ).results;
  return rows.map(({ payload, ...row }) => {
    const bars = payload ? JSON.parse(payload) : [];
    const stale =
      bars.length &&
      Date.parse(today()) - Date.parse(bars.at(-1).date) > 7 * 86400000;
    const analysisStart = new Date(Date.parse(completedDay()) - 330 * 86400000)
      .toISOString()
      .slice(0, 10);
    const analysis = analyzeBase(bars.filter((b) => b.date >= analysisStart));
    return {
      ...row,
      distances: stale ? null : priceDistances(bars, analysis),
      analysis: stale
        ? {
            stage: "資料過舊",
            reason: "最近日線已超過 7 天，暫停型態判定",
            date: bars.at(-1).date,
          }
        : analysis,
    };
  });
}
export async function scanWatchlist(env, userId = null) {
  if (userId) {
    const quotes = (
      await env.DB.prepare(
        "SELECT w.market,w.symbol FROM watchlist w LEFT JOIN quote_cache q ON q.market=w.market AND q.symbol=w.symbol WHERE w.user_id=? ORDER BY COALESCE(q.last_attempt,0),w.id LIMIT 5",
      )
        .bind(userId)
        .all()
    ).results;
    for (const row of quotes) await getQuote(env, row.market, row.symbol);
  }
  const rows = (
    await env.DB.prepare(
      `SELECT DISTINCT w.market,w.symbol FROM watchlist w LEFT JOIN stock_history h ON h.market=w.market AND h.symbol=w.symbol WHERE (? IS NULL OR w.user_id=?) AND (h.target_date IS NULL OR h.target_date<>?) AND (h.last_attempt IS NULL OR h.last_attempt<?) ORDER BY COALESCE(h.last_attempt,0),w.market,w.symbol LIMIT 5`,
    )
      .bind(
        userId,
        userId,
        "range252:" + completedDay(),
        Math.floor(Date.now() / 1000) - 600,
      )
      .all()
  ).results;
  for (const row of rows) {
    if (!userId) await getQuote(env, row.market, row.symbol);
    try {
      const name = await getStockName(env, row.market, row.symbol);
      await env.DB.prepare(
        "UPDATE watchlist SET name=? WHERE market=? AND symbol=? AND name<>?",
      )
        .bind(name, row.market, row.symbol, name)
        .run();
    } catch {
      /* A name lookup failure must not block price/history updates. */
    }
    await refreshHistory(env, row.market, row.symbol);
  }
  return rows.length;
}
