// Keep the displayed estimate independent from both quote requests and historical ledger snapshots.
export function compositionKey(portfolio, holdings) {
  return JSON.stringify([
    portfolio.mode,
    portfolio.cash,
    portfolio.rate,
    portfolio.data_date,
    holdings
      .map((h) => [
        h.market,
        h.symbol,
        h.quantity,
        h.manual_price ?? (h.manual ? h.price : null),
        h.manual_date ?? (h.manual ? h.priceDate : null),
      ])
      .sort((a, b) => {
        const left = JSON.stringify(a),
          right = JSON.stringify(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
  ]);
}
export function restoreEstimates(data) {
  const result = new Map();
  for (const row of data.portfolio_current || []) {
    const p = data.portfolios.find(
      (p) => p.account_id === row.account_id && p.mode === "holdings",
    );
    if (!p || !row.details_json) continue;
    try {
      const e = JSON.parse(row.details_json);
      const savedKey =
        row.composition_key ||
        compositionKey(
          {
            mode: "holdings",
            cash: e.cash,
            rate: e.rate,
            data_date: e.dataDate,
          },
          e.holdings,
        );
      const key = compositionKey(
        p,
        data.holdings.filter((h) => h.account_id === p.account_id),
      );
      if (savedKey !== key || !e.complete) continue;
      result.set(p.account_id, {
        ...e,
        compositionKey: key,
        checkedAt: new Date(row.checked_at).toISOString(),
        updateWarning: row.error || null,
      });
    } catch {
      /* An invalid cache must not prevent loading the user's ledger. */
    }
  }
  return result;
}
export function acceptEstimate(map, incoming) {
  const previous = map.get(incoming.accountId);
  if (
    previous?.complete &&
    previous.compositionKey === incoming.compositionKey &&
    (!incoming.complete || incoming.refreshFailed)
  ) {
    map.set(incoming.accountId, {
      ...previous,
      checkedAt: incoming.checkedAt || incoming.estimatedAt,
      updateWarning: incoming.pending
        ? "正在更新行情，沿用最近完整估算"
        : "行情更新不完整，沿用最近完整估算",
      warning: previous.warning || !!incoming.refreshFailed,
    });
  } else map.set(incoming.accountId, incoming);
}
export function estimateNeedsRefresh(estimate, now = Date.now()) {
  if (estimate?.currency === "USD" && !estimate.fxSource) return true;
  const checked = Date.parse(estimate?.checkedAt || estimate?.estimatedAt);
  return !Number.isFinite(checked) || now - checked >= 900000;
}
