import { decimal, symbolFor } from "../public/portfolio-domain.js";
import { today } from "../public/domain.js";
export const MARKET_URLS = {
  TWSE: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
};
function marketDate(value) {
  const s = String(value ?? "").trim();
  let result = s;
  if (/^\d{7}$/.test(s))
    result = `${Number(s.slice(0, 3)) + 1911}-${s.slice(3, 5)}-${s.slice(5, 7)}`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    isNaN(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result ||
    result > today()
  )
    throw Error("行情日期無效");
  return result;
}
export function parseQuote(market, symbol, data) {
  symbolFor(market, symbol);
  if (market === "US") {
    const notice = String(data?.error || "");
    if (/limit|too many|quota/i.test(notice))
      throw Error(
        "美股行情服務已限制請求（Finnhub 額度或頻率限制），請稍後再試",
      );
    if (/api.?key|token|unauthori|permission|access/i.test(notice))
      throw Error("美股行情服務密鑰無效或無權存取，請檢查 Finnhub 設定");
    if (notice || !Number.isFinite(data?.c) || data.c <= 0)
      throw Error("美股行情未回傳此代號的價格，請稍後更新或確認股票代號");
    if (
      !Number.isSafeInteger(data.t) ||
      data.t <= 0 ||
      data.t > Date.now() / 1000 + 300
    )
      throw Error("美股行情日期無效");
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(data.t * 1000));
    return {
      price: decimal(String(data.c), "行情價格"),
      price_date: marketDate(day),
      source: "Finnhub（最近成交）",
    };
  }
  if (!Array.isArray(data)) throw Error("台股行情格式錯誤");
  const row = data.find(
    (r) => (market === "TWSE" ? r.Code : r.SecuritiesCompanyCode) === symbol,
  );
  if (!row) throw Error("找不到此市場的股票，請確認市場與代號或手動補價");
  const price = String(market === "TWSE" ? row.ClosingPrice : row.Close)
    .replaceAll(",", "")
    .trim();
  return {
    price: decimal(price, "行情價格"),
    price_date: marketDate(row.Date),
    source: market === "TWSE" ? "證交所（日收盤）" : "櫃買中心（日收盤）",
  };
}
export function parseBackupQuote(symbol, data) {
  symbolFor("TPEX", symbol);
  const row =
    data?.rtcode === "0000" && Array.isArray(data.msgArray)
      ? data.msgArray.find((q) => q.c === symbol && q.ex === "otc")
      : null;
  if (!row || !/^\d{8}$/.test(row.d)) throw Error("備援行情缺少正確商品或日期");
  const day = `${row.d.slice(0, 4)}-${row.d.slice(4, 6)}-${row.d.slice(6, 8)}`;
  const time = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.t)
    ? ` ${row.t}`
    : "";
  return {
    price: decimal(row.z, "備援成交價格"),
    price_date: marketDate(day),
    source: `證交所基本市況（最近成交${time}，備援）`,
  };
}
export function parseFugleQuote(market, symbol, data) {
  symbolFor(market, symbol);
  const exchange =
    market === "TWSE" ? "TWSE" : market === "TPEX" ? "TPEx" : null;
  if (!exchange || data?.symbol !== symbol || data.exchange !== exchange)
    throw Error("富果行情商品或市場不符");
  const price = data.isClose === true ? data.closePrice : data.lastTrade?.price;
  if (!Number.isFinite(price) || price <= 0)
    throw Error("富果行情尚無有效成交價格");
  // lastTrial / indicative prices must never be used as actual trades.
  return {
    price: decimal(String(price), "富果成交價格"),
    price_date: marketDate(data.date),
    source: data.isClose === true ? "富果（日收盤）" : "富果（最近成交）",
  };
}
export async function fetchMarketQuote(
  market,
  symbol,
  fetchData = fetchJson,
  env = {},
) {
  symbolFor(market, symbol);
  if (!["TWSE", "TPEX"].includes(market)) throw Error("市場不支援此行情來源");
  let usingBackup = false;
  if (env.FUGLE_API_KEY) {
    try {
      return parseFugleQuote(
        market,
        symbol,
        await fetchData(
          "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/" +
            encodeURIComponent(symbol),
          false,
          { timeoutMs: 4000, headers: { "X-API-KEY": env.FUGLE_API_KEY } },
        ),
      );
    } catch {
      usingBackup = true;
    }
  }
  try {
    const quote = parseQuote(
      market,
      symbol,
      await fetchData(MARKET_URLS[market], true, {
        timeoutMs: market === "TPEX" ? 4000 : 12000,
      }),
    );
    return usingBackup ? { ...quote, source: quote.source + " · 備援" } : quote;
  } catch (e) {
    if (market !== "TPEX") throw e;
    // The TPEx host can time out from Workers even when it works on a local computer.
    // MIS is the exchange's official market-information site and also covers OTC instruments.
    const url =
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?" +
      new URLSearchParams({ ex_ch: `otc_${symbol}.tw`, json: "1", delay: "0" });
    return parseBackupQuote(symbol, await fetchData(url, true));
  }
}
async function fetchJson(
  url,
  publicData = false,
  { timeoutMs = 12000, headers = {} } = {},
) {
  const key = new Request(url);
  if (publicData && globalThis.caches) {
    const cached = await caches.default.match(key);
    if (cached) return cached.json();
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json", ...headers },
  });
  if (new URL(url).hostname === "finnhub.io") {
    if (response.status === 429)
      throw Error(
        "美股行情服務已限制請求（Finnhub 額度或頻率限制），請稍後再試",
      );
    if ([401, 403].includes(response.status))
      throw Error("美股行情服務密鑰無效或無權存取，請檢查 Finnhub 設定");
  }
  if (!response.ok) throw Error("行情來源暫時無法連線");
  const data = await response.json();
  if (
    publicData &&
    (Array.isArray(data) || data?.rtcode === "0000") &&
    globalThis.caches
  ) {
    const r = Response.json(data, {
      headers: { "Cache-Control": "public,max-age=900" },
    });
    await caches.default.put(key, r);
  }
  return data;
}
export function createQuoteService({
  fetchData = fetchJson,
  clock = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function getQuote(env, market, symbol, known) {
    symbolFor(market, symbol);
    const db = env.DB,
      now = clock();
    const previous =
      known === undefined
        ? await db
            .prepare("SELECT * FROM quote_cache WHERE market=? AND symbol=?")
            .bind(market, symbol)
            .first()
        : known;
    const ttl = 900;
    if (
      previous?.price &&
      previous.fetched_at > now - ttl &&
      (market !== "US" || previous.source?.startsWith("Finnhub"))
    )
      return { ...previous, warning: previous.error || null };
    const configuredSinceFailure =
      market === "US" &&
      env.FINNHUB_API_KEY &&
      previous?.error === "美股行情服務尚未啟用，請設定 Finnhub 密鑰";
    if (previous?.last_attempt > now - 600 && !configuredSinceFailure)
      return {
        ...previous,
        warning: previous.error || "行情更新中，沿用最近價格",
      };
    await db
      .prepare("INSERT OR IGNORE INTO quote_cache(market,symbol) VALUES(?,?)")
      .bind(market, symbol)
      .run();
    const reserved = await db
      .prepare(
        "UPDATE quote_cache SET last_attempt=?,error='' WHERE market=? AND symbol=? AND (last_attempt<=? OR error=?) RETURNING symbol",
      )
      .bind(
        now,
        market,
        symbol,
        now - 600,
        configuredSinceFailure
          ? "美股行情服務尚未啟用，請設定 Finnhub 密鑰"
          : "__no_retry__",
      )
      .first();
    if (!reserved) {
      const q = await db
        .prepare("SELECT * FROM quote_cache WHERE market=? AND symbol=?")
        .bind(market, symbol)
        .first();
      return { ...q, warning: q?.error || "行情更新中，請稍後再試" };
    }
    try {
      let url = MARKET_URLS[market];
      if (market === "US") {
        if (!env.FINNHUB_API_KEY)
          throw Error("美股行情服務尚未啟用，請設定 Finnhub 密鑰");
        const requested = Number(env.FINNHUB_PER_MINUTE_LIMIT || 50),
          limit =
            Number.isSafeInteger(requested) && requested > 0
              ? Math.min(requested, 10000)
              : 50;
        const day = new Date(now * 1000).toISOString().slice(0, 16);
        const budget = await db
          .prepare(
            "INSERT INTO quote_limits(provider,day,count) VALUES(?,?,1) ON CONFLICT(provider,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
          )
          .bind("finnhub", day, limit)
          .first();
        if (!budget) throw Error("美股行情本分鐘更新額度已用完，請稍後再試");
        url =
          "https://finnhub.io/api/v1/quote?" + new URLSearchParams({ symbol });
      }
      const q =
        market === "US"
          ? parseQuote(
              market,
              symbol,
              await fetchData(url, false, {
                headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
              }),
            )
          : await fetchMarketQuote(market, symbol, fetchData, env);
      await db
        .prepare(
          "UPDATE quote_cache SET price=?,price_date=?,source=?,fetched_at=?,error='' WHERE market=? AND symbol=?",
        )
        .bind(q.price, q.price_date, q.source, now, market, symbol)
        .run();
      return { ...q, fetched_at: now, warning: null };
    } catch (e) {
      // Never include provider URLs, API keys, raw responses or fetch exception text in client errors.
      const safe =
        e.message?.startsWith("美股") ||
        e.message?.startsWith("今日美股") ||
        e.message?.startsWith("找不到")
          ? e.message
          : "行情暫時無法更新，請沿用最近價格或手動補價";
      await db
        .prepare("UPDATE quote_cache SET error=? WHERE market=? AND symbol=?")
        .bind(safe, market, symbol)
        .run();
      return { ...previous, warning: safe };
    }
  };
}
export const getQuote = createQuoteService();
