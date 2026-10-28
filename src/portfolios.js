import {
  requireThat,
  money,
  rate,
  date,
  today,
  accountState,
  FX,
  validateTimeline,
} from "../public/domain.js";
import {
  decimal,
  symbolFor,
  portfolioValue,
} from "../public/portfolio-domain.js";
import { getQuote } from "./market-data.js";
import { getExchangeRate } from "./exchange-rates.js";
import { compositionKey, restoreEstimates } from "../public/estimate-state.js";
export function eligible(account) {
  return (
    (account.type === "股票" && account.currency === "TWD") ||
    (account.type === "美股" && account.currency === "USD")
  );
}
export function portfolioStatements(db, u, b, d) {
  const a = d.accounts.find((a) => a.id === b.accountId);
  requireThat(a, "帳戶不存在或無權存取");
  requireThat(eligible(a), "持股估值支援台幣股票帳戶與美元美股帳戶");
  requireThat(["manual", "holdings"].includes(b.mode), "估值模式無效");
  if (b.mode === "manual")
    return [
      db
        .prepare(
          "UPDATE portfolios SET mode='manual',updated_at=? WHERE account_id=? AND user_id=?",
        )
        .bind(new Date().toISOString(), a.id, u.id),
    ];
  const current = d.portfolios.find((p) => p.account_id === a.id);
  const cash = money(b.cash, "現金餘額"),
    fx = rate(
      b.rate ?? (current?.rate ?? accountState(a, d.events).rate) / FX,
      a.currency,
    ),
    day = date(b.dataDate ?? today());
  requireThat(day >= a.created_date, "資料日期不能早於開戶日期");
  requireThat(
    Array.isArray(b.holdings) && b.holdings.length <= 100,
    "每個帳戶最多 100 檔持股",
  );
  const seen = new Set(),
    rows = b.holdings.map((h) => {
      requireThat(h && typeof h === "object", "持股格式錯誤");
      const market = h.market,
        symbol = symbolFor(market, h.symbol);
      requireThat(
        a.currency === "USD"
          ? market === "US"
          : ["TWSE", "TPEX"].includes(market),
        "持股市場與帳戶幣別不符",
      );
      const key = market + ":" + symbol;
      requireThat(!seen.has(key), "同一市場股票代號不可重複");
      seen.add(key);
      const quantity = decimal(h.quantity, "持有股數");
      const manual =
        h.manualPrice !== "" &&
        h.manualPrice !== null &&
        h.manualPrice !== undefined;
      return {
        market,
        symbol,
        quantity,
        price: manual ? decimal(h.manualPrice, "手動價格") : null,
        priceDate: manual ? date(h.manualDate) : null,
      };
    });
  return [
    db
      .prepare(
        "INSERT INTO portfolios(account_id,user_id,mode,cash,rate,data_date,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET mode=excluded.mode,cash=excluded.cash,rate=excluded.rate,data_date=excluded.data_date,updated_at=excluded.updated_at",
      )
      .bind(a.id, u.id, b.mode, cash, fx, day, new Date().toISOString()),
    db
      .prepare("DELETE FROM holdings WHERE user_id=? AND account_id=?")
      .bind(u.id, a.id),
    db
      .prepare(
        "INSERT INTO holdings(id,user_id,account_id,market,symbol,quantity,manual_price,manual_date) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.market'),json_extract(value,'$.symbol'),json_extract(value,'$.quantity'),json_extract(value,'$.price'),json_extract(value,'$.priceDate') FROM json_each(?)",
      )
      .bind(
        u.id,
        a.id,
        JSON.stringify(rows.map((h) => ({ ...h, id: crypto.randomUUID() }))),
      ),
  ];
}
export async function estimates(
  env,
  u,
  b,
  d,
  quote = getQuote,
  exchangeRate = getExchangeRate,
) {
  const ids =
    b.accountIds === undefined
      ? d.portfolios
          .filter((p) => p.mode === "holdings")
          .map((p) => p.account_id)
      : b.accountIds;
  requireThat(Array.isArray(ids) && ids.length <= 10, "一次最多更新 10 個帳戶");
  const selected = [...new Set(ids)].map((id) => {
    const a = d.accounts.find((a) => a.id === id);
    requireThat(a, "帳戶不存在或無權存取");
    return a;
  });
  const autoKeys = [
    ...new Set(
      d.holdings
        .filter((h) => ids.includes(h.account_id) && !h.manual_price)
        .map((h) => h.market + ":" + h.symbol),
    ),
  ];
  requireThat(
    autoKeys.length <= 100,
    "一次最多更新 100 檔股票，請分別開啟帳戶更新",
  );
  const cachedRows = autoKeys.length
    ? (
        await env.DB.prepare(
          `SELECT * FROM quote_cache WHERE (market||':'||symbol) IN (${autoKeys.map(() => "?").join(",")})`,
        )
          .bind(...autoKeys)
          .all()
      ).results
    : [];
  const cached = new Map(cachedRows.map((q) => [q.market + ":" + q.symbol, q])),
    memo = new Map();
  let remoteSymbols = 0;
  const quoteFor = async (h) => {
    const key = h.market + ":" + h.symbol;
    if (!memo.has(key)) {
      const previous = cached.get(key) || null,
        now = Math.floor(Date.now() / 1000),
        ttl = 900;
      const ready =
        previous?.price &&
        previous.fetched_at > now - ttl &&
        (h.market !== "US" || previous.source?.startsWith("Finnhub"));
      const newKey =
        h.market === "US" &&
        env.FINNHUB_API_KEY &&
        previous?.error === "美股行情服務尚未啟用，請設定 Finnhub 密鑰";
      const backedOff = previous?.last_attempt > now - 600 && !newKey;
      let q;
      if (h.market === "US" && !env.FINNHUB_API_KEY)
        q = {
          ...previous,
          warning: "美股行情服務尚未啟用，請設定 Finnhub 密鑰",
        };
      else if (ready || backedOff)
        q = await quote(env, h.market, h.symbol, previous);
      else if (remoteSymbols < 5) {
        remoteSymbols++;
        q = await quote(env, h.market, h.symbol, previous);
      } else
        q = { ...previous, pending: true, warning: "正在分批更新行情，請稍候" };
      memo.set(key, q);
    }
    return memo.get(key);
  };
  const results = [];
  const priorCurrent = restoreEstimates(d);
  const fxMemo = new Map();
  for (const a of selected) {
    const p = d.portfolios.find(
      (p) => p.account_id === a.id && p.mode === "holdings",
    );
    if (!p) continue;
    const holdings = [];
    for (const h of d.holdings.filter((h) => h.account_id === a.id)) {
      const q = h.manual_price
        ? {
            price: h.manual_price,
            price_date: h.manual_date,
            source: "手動價格",
            warning: null,
          }
        : await quoteFor(h);
      const old =
        q.price_date &&
        Date.parse(today()) - Date.parse(q.price_date) > 4 * 86400000;
      holdings.push({
        id: h.id,
        market: h.market,
        symbol: h.symbol,
        quantity: h.quantity,
        price: q.price || null,
        priceDate: q.price_date || null,
        source: q.source || null,
        fetchedAt: q.fetched_at
          ? new Date(q.fetched_at * 1000).toISOString()
          : null,
        warning: q.warning || (old ? "價格日期較舊，請確認後再儲存" : null),
        manual: !!h.manual_price,
        pending: !!q.pending,
        refreshFailed: !!q.warning && !q.pending,
      });
    }
    if (!fxMemo.has(a.currency))
      fxMemo.set(a.currency, await exchangeRate(env, a.currency));
    const fx = fxMemo.get(a.currency),
      prior = priorCurrent.get(a.id);
    const value = portfolioValue(
        p.cash,
        fx.rate || prior?.rate || p.rate,
        holdings,
      ),
      pending = holdings.some((h) => h.pending),
      id = pending ? null : crypto.randomUUID(),
      now = Math.floor(Date.now() / 1000);
    const result = {
      ...value,
      pending,
      complete: value.complete && !pending,
      total: pending ? null : value.total,
      totalTwd: pending ? null : value.totalTwd,
      id,
      accountId: a.id,
      currency: a.currency,
      dataDate: p.data_date,
      estimatedAt: new Date(now * 1000).toISOString(),
      warning: holdings.some((h) => h.warning) || !!fx.warning,
      fxDate: fx.date || prior?.fxDate || null,
      fxSource:
        fx.source ||
        prior?.fxSource ||
        (a.currency === "TWD" ? null : "帳戶原有匯率"),
      fxWarning: fx.warning || null,
      refreshFailed: holdings.some((h) => h.refreshFailed),
      version: d.revisions[0].version,
      compositionKey: compositionKey(
        p,
        d.holdings.filter((h) => h.account_id === a.id),
      ),
      checkedAt: new Date().toISOString(),
    };
    if (!pending)
      await env.DB.prepare(
        "INSERT INTO portfolio_estimates(id,user_id,account_id,version,amount,rate,complete,created_at,expires_at,details_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          u.id,
          a.id,
          result.version,
          result.total,
          result.rate,
          result.complete ? 1 : 0,
          now,
          now + 900,
          JSON.stringify(result),
        )
        .run();
    results.push(result);
    const checked = Date.parse(result.checkedAt);
    const publish =
      result.complete && (!result.refreshFailed || !priorCurrent.has(a.id));
    const cacheError = pending
      ? "行情正在分批更新"
      : result.refreshFailed
        ? "行情更新失敗，沿用最近完整估算"
        : result.complete
          ? ""
          : "行情更新不完整，沿用最近完整估算";
    await env.DB.prepare(
      `INSERT INTO portfolio_current(account_id,user_id,composition_key,details_json,checked_at,updated_at,error)
       SELECT ?,?,?,?,?,?,? FROM revisions WHERE user_id=? AND version=?
       ON CONFLICT(account_id) DO UPDATE SET
        composition_key=excluded.composition_key,
        details_json=CASE WHEN excluded.details_json IS NOT NULL THEN excluded.details_json WHEN portfolio_current.composition_key=excluded.composition_key OR (portfolio_current.composition_key='' AND ?) THEN portfolio_current.details_json ELSE NULL END,
        updated_at=CASE WHEN excluded.details_json IS NOT NULL THEN excluded.updated_at WHEN portfolio_current.composition_key=excluded.composition_key OR (portfolio_current.composition_key='' AND ?) THEN portfolio_current.updated_at ELSE NULL END,
        checked_at=excluded.checked_at,error=excluded.error
       WHERE portfolio_current.checked_at<=excluded.checked_at`,
    )
      .bind(
        a.id,
        u.id,
        result.compositionKey,
        publish ? JSON.stringify(result) : null,
        checked,
        publish ? checked : null,
        cacheError,
        u.id,
        result.version,
        priorCurrent.get(a.id)?.compositionKey === result.compositionKey
          ? 1
          : 0,
        priorCurrent.get(a.id)?.compositionKey === result.compositionKey
          ? 1
          : 0,
      )
      .run();
  }
  await env.DB.prepare(
    "DELETE FROM portfolio_estimates WHERE user_id=? AND expires_at<? AND NOT EXISTS(SELECT 1 FROM events WHERE portfolio_estimate_id=portfolio_estimates.id)",
  )
    .bind(u.id, Math.floor(Date.now() / 1000) - 86400)
    .run();
  return results;
}
export async function snapshotEvent(db, u, b, d) {
  const r = await db
    .prepare(
      "SELECT * FROM portfolio_estimates WHERE id=? AND user_id=? AND account_id=?",
    )
    .bind(b.estimateId, u.id, b.accountId)
    .first();
  requireThat(
    r && r.complete && r.amount !== null,
    "估值不完整或不存在，請先更新行情",
  );
  requireThat(
    r.version === b.version && r.expires_at >= Math.floor(Date.now() / 1000),
    "估值已過期或資料有變動，請更新估值後再儲存",
  );
  const a = d.accounts.find((a) => a.id === b.accountId);
  requireThat(a, "帳戶不存在或無權存取");
  const e = {
    id: Number.MAX_SAFE_INTEGER,
    account_id: a.id,
    date: today(),
    kind: "valuation",
    amount: r.amount,
    rate: r.rate,
    cost_delta: 0,
    cost_twd_delta: 0,
    note: "現金＋持股估值快照",
    estimateId: r.id,
  };
  validateTimeline(a, [...d.events, e]);
  return e;
}
export function cashFlowStatements(
  db,
  u,
  d,
  accountId,
  delta,
  fx,
  day = today(),
) {
  const p = d.portfolios.find(
    (p) => p.account_id === accountId && p.mode === "holdings",
  );
  if (!p) return [];
  requireThat(p.cash + delta >= 0, "現金餘額不足，請先更新現金與持股資料");
  requireThat(Number.isSafeInteger(p.cash + delta), "現金餘額超出精確計算範圍");
  return [
    db
      .prepare(
        "UPDATE portfolios SET cash=cash+?,rate=?,data_date=?,updated_at=? WHERE user_id=? AND account_id=?",
      )
      .bind(
        delta,
        day >= p.data_date && fx ? fx : p.rate,
        today(),
        new Date().toISOString(),
        u.id,
        accountId,
      ),
  ];
}
