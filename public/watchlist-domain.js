// Sequential replay: every decision uses only candles known on that day.
export function analyzeBase(bars) {
  if (bars.length < 80)
    return { stage: "資料不足", reason: "至少需要 80 個交易日的還原日線" };
  let pattern = null,
    result;
  for (let i = 79; i < bars.length; i++) {
    const b = bars[i],
      prior = bars.slice(i - 40, i);
    const support = Math.min(...prior.map((x) => x.low));
    const ceiling = Math.max(...prior.map((x) => x.high));
    const oldLow = Math.min(...bars.slice(i - 79, i - 19).map((x) => x.low));
    const recentLow = Math.min(...bars.slice(i - 19, i + 1).map((x) => x.low));
    if (pattern) {
      if (
        b.close < pattern.support ||
        (pattern.breakout !== null && b.close < pattern.ceiling * 0.97)
      ) {
        result = {
          ...pattern,
          stage: "型態失效",
          reason: "收盤跌破底部支撐，或突破後跌回區間上緣 3% 以下",
        };
        pattern = null;
        continue;
      }
      if (pattern.breakout === null && b.close > pattern.ceiling)
        pattern.breakout = i;
      if (pattern.breakout !== null) {
        if (
          i > pattern.breakout &&
          i - pattern.breakout <= 10 &&
          b.low <= pattern.ceiling * 1.03 &&
          b.close >= pattern.ceiling * 0.97
        )
          pattern.confirmed = true;
        result = {
          ...pattern,
          stage: pattern.confirmed ? "回測確認" : "突破待確認",
          reason: pattern.confirmed
            ? "突破後 10 個交易日內回測上緣 ±3%，收盤守住容許範圍"
            : "收盤突破已固定的整理區上緣，尚未出現符合規則的回測",
        };
        continue;
      }
      result = {
        ...pattern,
        stage: "築底觀察",
        reason: "已形成整理區，持續觀察固定支撐與區間上緣",
      };
      continue;
    }
    if (recentLow >= oldLow && ceiling / support <= 1.15) {
      pattern = {
        support,
        ceiling,
        breakout: b.close > ceiling ? i : null,
        confirmed: false,
        baseDate: b.date,
      };
      result = {
        ...pattern,
        stage: pattern.breakout === null ? "築底觀察" : "突破待確認",
        reason: "近 20 日未跌破之前 60 日低點；前 40 日區間振幅不超過 15%",
      };
    } else if (b.low < Math.min(...bars.slice(i - 60, i).map((x) => x.low))) {
      result = { stage: "下跌中", reason: "今日最低價跌破前 60 個交易日低點" };
    } else
      result = {
        stage: "尚未形成",
        reason: "目前未符合創低或築底條件，持續觀察",
      };
  }
  return { ...result, date: bars.at(-1).date };
}

// Percentages always compare adjusted daily prices on the same basis.
export function priceDistances(bars, analysis = {}) {
  const latest = bars.at(-1);
  if (!latest) return null;
  const window = bars.slice(-252);
  const complete = window.length === 252;
  let low = null,
    high = null;
  if (complete) {
    for (const bar of window) {
      if (!low || bar.low <= low.price)
        low = { price: bar.low, date: bar.date };
      if (!high || bar.high >= high.price)
        high = { price: bar.high, date: bar.date };
    }
  }
  const change = (reference) => (latest.close / reference - 1) * 100;
  const validSupport =
    ["築底觀察", "突破待確認", "回測確認"].includes(analysis.stage) &&
    Number.isFinite(analysis.support) &&
    analysis.support > 0;
  return {
    date: latest.date,
    close: latest.close,
    sessions: window.length,
    complete,
    low,
    high,
    fromLow: low ? change(low.price) : null,
    fromHigh: high ? change(high.price) : null,
    fromSupport: validSupport ? change(analysis.support) : null,
  };
}
