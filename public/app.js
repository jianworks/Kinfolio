import { accountState, toTwd, today, FX } from "./domain.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  modal = $("#modal");
let state,
  config,
  page = "overview",
  holder = "all",
  asOf = today(),
  busy = false;
const icons = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  accounts:
    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-6 5h3M6 5V3"/>',
  transfers: '<path d="M3 7h17l-4-4M21 17H4l4 4"/>',
  loans: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
  goals:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 8-8"/>',
  holders:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  arrow: '<path d="m3 17 6-6 4 4 8-10m-7 0h7v7"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.accounts}</svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v, d = 0) =>
  new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  }).format(v / 100);
const pct = (v) =>
  `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(v)}%`;
const colors = ["#34664e", "#88a67a", "#bdcda8", "#dfcf9a"];
const types = ["股票", "期貨", "美股", "未上市公司"];
const kindNames = {
  opening: "開戶",
  valuation: "帳戶估值",
  deposit: "投入資金",
  withdrawal: "提領資金",
  transfer_in: "移轉轉入",
  transfer_out: "移轉轉出",
};
const empty = (title, body = "", action = "") =>
  `<div class="empty"><strong>${title}</strong>${body}${action ? `<br>${action}` : ""}</div>`;
const btn = (label, action, primary = false, ico = "plus") =>
  `<button class="button${primary ? " primary" : ""}" data-action="${action}">${icon(ico)}${label}</button>`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body
      ? JSON.stringify({ ...body, version: state?.revisions?.[0]?.version })
      : undefined,
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error("無法連線至服務");
  }
  if (!r.ok) {
    if (r.status === 401 && path !== "auth/google") {
      state = null;
      login();
    }
    throw new Error(d.error || "操作失敗");
  }
  return d;
}
async function refresh() {
  state = await api("state");
  render();
}
function accountsAt(day = asOf, h = holder) {
  return state.accounts
    .filter((a) => h === "all" || a.holder_id === h)
    .map((a) => accountState(a, state.events, day))
    .filter((a) => a.lastDate);
}
function loansAt(day = asOf, h = holder) {
  return state.loans
    .filter((l) => h === "all" || l.holder_id === h)
    .map((l) => {
      const r = state.loan_balances
        .filter((r) => r.loan_id === l.id && r.date <= day)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
      return {
        ...l,
        ...(r
          ? {
              balance: r.balance,
              rate: r.rate,
              lastDate: r.date,
              valueTwd: toTwd(r.balance, r.rate),
            }
          : { balance: 0, rate: FX, valueTwd: 0, lastDate: null }),
      };
    });
}
function totals(day = asOf, h = holder) {
  const a = accountsAt(day, h),
    l = loansAt(day, h);
  const value = a.reduce((n, a) => n + a.valueTwd, 0),
    cost = a.reduce((n, a) => n + a.costTwd, 0),
    debt = l.reduce((n, l) => n + l.valueTwd, 0);
  return { value, cost, debt, net: value - debt, profit: value - cost };
}
const holderName = (id) => state.holders.find((h) => h.id === id)?.name || "";
const accountName = (id) => state.accounts.find((a) => a.id === id)?.name || "";
function brand() {
  return '<div class="brand"><div class="brandmark">家</div><div><strong>家計</strong><small>KINFOLIO</small></div></div>';
}
function render() {
  if (!state) return;
  const labels = {
    overview: "資產總覽",
    accounts: "投資帳戶",
    transfers: "資金移轉",
    loans: "貸款管理",
    goals: "資產目標",
    holders: "持有人",
  };
  app.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<nav class="nav" aria-label="主選單">${Object.entries(
    labels,
  )
    .map(
      ([key, label]) =>
        `<button data-page="${key}" class="${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(key)}${label}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="privacy">每一筆累積，離目標更近一步。<br>金額統一以新台幣彙總。</div><div class="user"><div class="avatar">${esc(state.user.name.slice(0, 1))}</div><span>${esc(state.user.name)}</span><button class="logout" data-action="logout">登出</button></div></div></aside><main class="main"><header class="topbar"><span>家庭財務 / <strong>${labels[page]}</strong></span><strong>${esc(state.user.email)}</strong></header><div class="workspace"><div class="heading"><div><div class="eyebrow">YOUR WEALTH, IN PERSPECTIVE</div><h1>${labels[page]}</h1><p class="subtitle">${{ overview: "讓每一份資產，都有清楚的全貌。", accounts: "追蹤投入本金、帳戶價值與投資成果。", transfers: "串起帳戶之間的資金與本金流向。", loans: "記錄貸款餘額，掌握你的淨資產。", goals: "為每位持有人，設定下一個里程碑。", holders: "分別管理每位家人的資產與目標。" }[page]}</p></div><div class="actions">${page === "overview" ? btn("資金移轉", "transfer", false, "transfers") + btn("記錄估值", "valuation", true) : page === "accounts" ? btn("新增帳戶", "account", true) : page === "transfers" ? btn("新增移轉", "transfer", true) : page === "loans" ? btn("新增貸款", "loan", true) : page === "goals" ? btn("新增目標", "goal", true) : btn("新增持有人", "holder", true)}</div></div>${config.dev ? '<div class="notice">本機開發模式 · 資料儲存在本機 D1，正式部署一律使用 Google 登入。 <button class="link-button" data-action="sample">建立示範資料</button></div>' : ""}<div class="filters"><div class="tabs" aria-label="持有人篩選"><button data-holder="all" class="${holder === "all" ? "selected" : ""}">全部持有人</button>${state.holders.map((h) => `<button data-holder="${h.id}" class="${holder === h.id ? "selected" : ""}">${esc(h.name)}</button>`).join("")}</div><label class="date-filter">檢視日期 <input id="as-of" type="date" max="${today()}" value="${asOf}" aria-label="檢視日期"></label></div>${{ overview: overview, accounts: accountPage, transfers: transferPage, loans: loanPage, goals: goalPage, holders: holderPage }[page]()}<footer class="footer"><span>家計 Kinfolio · 依各帳戶最近記錄彙總，非即時行情</span><button data-action="export">${icon("download")} 匯出資料備份</button></footer></div></main></div>`;
  $("#as-of").onchange = (e) => {
    asOf = e.target.value || today();
    render();
  };
  const exportButton = $('[data-action="export"] svg');
  if (exportButton) {
    exportButton.setAttribute("width", "12");
    exportButton.setAttribute("height", "12");
  }
}
function stats() {
  const t = totals();
  return `<div class="stats">${[
    {
      label: "資產總值",
      value: t.value,
      foot: `${accountsAt().length} 個投資帳戶 · TWD`,
      main: true,
      icon: "accounts",
    },
    {
      label: "累計投入本金",
      value: t.cost,
      foot: "依歷史匯率計算台幣成本",
      icon: "transfers",
    },
    {
      label: "累計投資損益",
      value: t.profit,
      foot: t.cost
        ? pct((t.profit / t.cost) * 100) + " 簡單報酬率"
        : "尚無投入本金",
      icon: "arrow",
    },
    {
      label: "淨資產",
      value: t.net,
      foot: "貸款餘額 NT$ " + fmt(t.debt),
      icon: "loans",
    },
  ]
    .map(
      (s) =>
        `<div class="stat${s.main ? " main-stat" : ""}"><div class="stat-label">${s.label}<span class="stat-icon">${icon(s.icon)}</span></div><div class="stat-value ${s.label === "累計投資損益" ? (s.value < 0 ? "down" : "up") : ""}"><small>NT$</small>${fmt(s.value)}</div><div class="stat-foot">${s.foot}</div></div>`,
    )
    .join("")}</div>`;
}
function chart() {
  const relevant = state.accounts
    .filter((a) => holder === "all" || a.holder_id === holder)
    .map((a) => a.id);
  let days = [
    ...new Set(
      state.events
        .filter((e) => relevant.includes(e.account_id) && e.date <= asOf)
        .map((e) => e.date),
    ),
  ].sort();
  if (!days.length)
    return empty(
      "從第一筆估值開始",
      "新增帳戶與定期估值後，即可追蹤資產的變化。",
    );
  if (days[days.length - 1] !== asOf) days.push(asOf);
  if (days.length > 24) {
    const all = days;
    days = Array.from(
      { length: 24 },
      (_, i) => all[Math.round((i * (all.length - 1)) / 23)],
    );
  }
  const points = days.map((day) => ({ day, ...totals(day) })),
    max = Math.max(...points.flatMap((p) => [p.value, p.cost]), 100),
    W = 680,
    H = 205,
    top = 12,
    bottom = 172,
    left = 62,
    right = 665,
    x = (i) => left + (i * (right - left)) / Math.max(points.length - 1, 1),
    y = (v) => bottom - (v / max) * (bottom - top),
    path = (key) =>
      points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[key])}`).join(" ");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="資產總值與投入本金歷史趨勢"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8dad7c" stop-opacity=".27"/><stop offset="100%" stop-color="#8dad7c" stop-opacity=".01"/></linearGradient></defs>${[
    0, 1, 2, 3,
  ]
    .map((i) => {
      const v = (max * i) / 3;
      return `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="#edf0e9" stroke-dasharray="3 5"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 1 }).format(v / 100)}</text>`;
    })
    .join(
      "",
    )}<path d="${path("value")} L${x(points.length - 1)},${bottom} L${left},${bottom} Z" fill="url(#area)"/><path d="${path("cost")}" stroke="#c0c8b5" stroke-width="1.6" stroke-dasharray="5 5" fill="none"/><path d="${path("value")}" stroke="#46775a" stroke-width="2.7" fill="none"/>${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="#46775a"><title>${p.day}：NT$ ${fmt(p.value)}</title></circle>`).join("")}${[...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].map((i) => `<text x="${x(i)}" y="198" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${points[i].day}</text>`).join("")}</svg></div><div class="chart-note">沿用最近一次估值與匯率；損益包含匯率變化，不是年化報酬。</div>`;
}
function allocation() {
  const a = accountsAt(),
    total = a.reduce((s, a) => s + a.valueTwd, 0);
  let acc = 0;
  const segments = types.map((t, i) => {
    const v = a.filter((a) => a.type === t).reduce((s, a) => s + a.valueTwd, 0),
      p = total ? (v / total) * 100 : 0,
      start = acc;
    acc += p;
    return { type: t, p, color: colors[i], start, end: acc };
  });
  return `<div class="allocation"><div class="donut" id="allocation-donut"><div class="donut-hole"><strong>${a.length}</strong><small>投資帳戶</small></div></div><div class="alloc-list">${segments.map((s) => `<div class="alloc-row"><span class="alloc-name"><span class="dot" data-color="${s.color}"></span>${s.type}</span><strong>${pct(s.p)}</strong></div>`).join("")}</div></div><div id="allocation-data" hidden>${esc(JSON.stringify(segments))}</div>`;
}
function accountTable() {
  const a = accountsAt();
  return `<section class="panel table-panel"><div class="panel-head"><h2>投資帳戶 <small> / ${a.length}</small></h2><button class="link-button" data-action="account">＋ 新增帳戶</button></div>${!a.length ? empty("建立你的第一個投資帳戶", "支援台幣、美金與日幣，按持有人分別追蹤。", btn("新增帳戶", "account", true)) : `<div class="table-wrap"><table><thead><tr><th>帳戶 / 持有人</th><th>類型</th><th class="num">投入本金（原幣）</th><th class="num">帳戶價值（原幣）</th><th class="num">台幣價值</th><th class="num">損益（台幣）</th><th></th></tr></thead><tbody>${a.map((a) => `<tr><td><div class="account-name"><span class="account-symbol">${a.currency === "TWD" ? "台" : a.currency === "USD" ? "美" : "日"}</span><div>${esc(a.name)}<small>${esc(holderName(a.holder_id))} · ${a.currency}</small></div></div></td><td><span class="tag">${a.type}</span></td><td class="num">${fmt(a.cost, 2)}</td><td class="num">${fmt(a.value, 2)}<small>${a.lastDate} · 匯率 ${a.rate / FX}</small></td><td class="num">${fmt(a.valueTwd)}</td><td class="num ${a.valueTwd - a.costTwd < 0 ? "down" : "up"}">${a.valueTwd - a.costTwd >= 0 ? "+" : ""}${fmt(a.valueTwd - a.costTwd)}<small>${a.costTwd ? pct(((a.valueTwd - a.costTwd) / a.costTwd) * 100) : "—"}</small></td><td><button class="link-button" data-detail="${a.id}">明細 ↗</button></td></tr>`).join("")}</tbody></table></div>`}</section>`;
}
function goalsList() {
  const goals = state.goals.filter(
    (g) => holder === "all" || g.holder_id === holder,
  );
  return goals.length
    ? `<div class="goal-list">${goals
        .map((g) => {
          const t = totals(asOf, g.holder_id),
            value = g.basis === "net" ? t.net : t.value,
            p = Math.max(0, (value / g.target) * 100);
          return `<div><div class="goal-title"><span>${esc(g.name)}</span><strong>${pct(p)}</strong></div><div class="goal-meta"><span>${esc(holderName(g.holder_id))} · ${g.basis === "net" ? "淨資產" : "總資產"}</span><span>${g.date}</span></div><div class="progress"><div class="progress-fill" data-progress="${Math.min(p, 100)}"></div></div><div class="goal-meta"><span>NT$ ${fmt(value)} / ${fmt(g.target)}</span><span>${p >= 100 ? "已達成" : "差額 " + fmt(Math.max(0, g.target - value))}</span></div>${page === "goals" ? `<button class="link-button danger" data-delete-table="goals" data-delete-id="${g.id}">刪除目標</button>` : ""}</div>`;
        })
        .join("")}</div>`
    : empty(
        "下一個里程碑是什麼？",
        "設定每位持有人的總資產或淨資產目標。",
        btn("設定目標", "goal"),
      );
}
function activities() {
  const ids = accountsAt().map((a) => a.id),
    events = state.events
      .filter((e) => ids.includes(e.account_id) && e.date <= asOf)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 4);
  return events.length
    ? `<div class="mini-list">${events.map((e) => `<div class="activity"><div class="activity-icon">${e.kind === "valuation" ? "↗" : e.amount < 0 ? "↗" : "↙"}</div><div class="activity-text">${esc(accountName(e.account_id))} · ${kindNames[e.kind]}<small>${e.date}</small></div><div class="activity-amount">${fmt(e.amount, 2)}<div class="subtitle">${state.accounts.find((a) => a.id === e.account_id)?.currency}</div></div></div>`).join("")}</div>`
    : empty("目前還沒有記錄");
}
function overview() {
  return `${stats()}<div class="grid"><section class="panel"><div class="panel-head"><h2>資產趨勢</h2><div class="legend"><span>資產總值</span><span class="cost-legend">投入本金</span></div></div>${chart()}</section><section class="panel"><div class="panel-head"><h2>資產配置</h2><small>依帳戶類型</small></div>${allocation()}</section></div>${accountTable()}<div class="grid"><section class="panel"><div class="panel-head"><h2>資產目標</h2><button class="link-button" data-action="goal">＋ 設定目標</button></div>${goalsList()}</section><section class="panel"><div class="panel-head"><h2>最近動態</h2><small>截至 ${asOf}</small></div>${activities()}</section></div>`;
}
function accountPage() {
  return stats() + accountTable();
}
function transferPage() {
  const ids = state.accounts
      .filter((a) => holder === "all" || a.holder_id === holder)
      .map((a) => a.id),
    out = state.events
      .filter(
        (e) =>
          e.kind === "transfer_out" &&
          e.date <= asOf &&
          (ids.includes(e.account_id) ||
            state.events.some(
              (i) =>
                i.transfer_id === e.transfer_id && ids.includes(i.account_id),
            )),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return `<div class="notice">移轉同時調整兩端帳戶價值及投入本金。跨幣別以實際轉入金額記錄，原始台幣成本會保留；無手續費欄位，請以實收金額反映費用。</div><section class="panel table-panel"><div class="panel-head"><h2>移轉記錄</h2><small>${out.length} 筆</small></div>${
    out.length
      ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>轉出 → 轉入</th><th class="num">轉出金額 / 本金</th><th class="num">轉入金額 / 本金</th><th>備註</th></tr></thead><tbody>${out
          .map((o) => {
            const i = state.events.find(
                (e) =>
                  e.transfer_id === o.transfer_id && e.kind === "transfer_in",
              ),
              a = state.accounts.find((a) => a.id === o.account_id),
              b = state.accounts.find((a) => a.id === i.account_id);
            return `<tr><td>${o.date}</td><td>${esc(a.name)} → ${esc(b.name)}<small>${esc(holderName(a.holder_id))} → ${esc(holderName(b.holder_id))}</small></td><td class="num">${a.currency} ${fmt(-o.amount, 2)}<small>本金 ${fmt(-o.cost_delta, 2)}</small></td><td class="num">${b.currency} ${fmt(i.amount, 2)}<small>本金 ${fmt(i.cost_delta, 2)}</small></td><td>${esc(o.note)}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : empty("還沒有帳戶移轉", "先建立至少兩個帳戶，再記錄資金流向。")
  }</section>`;
}
function loanPage() {
  const loans = loansAt();
  return `${stats()}<section class="panel table-panel"><div class="panel-head"><h2>貸款清單</h2><small>以貸款餘額計入負債</small></div>${loans.length ? `<div class="table-wrap"><table><thead><tr><th>貸款 / 持有人</th><th class="num">年利率</th><th class="num">剩餘本金（原幣）</th><th class="num">台幣餘額</th><th>最後記錄</th><th></th></tr></thead><tbody>${loans.map((l) => `<tr><td>${esc(l.name)}<small>${esc(holderName(l.holder_id))} · ${l.currency}</small></td><td class="num">${pct(l.annual_rate)}</td><td class="num">${l.lastDate ? fmt(l.balance, 2) : "尚無記錄"}</td><td class="num">${fmt(l.valueTwd)}</td><td>${l.lastDate || "—"}</td><td><button class="link-button" data-loan="${l.id}">更新餘額</button><button class="link-button" data-loan-history="${l.id}">歷史</button></td></tr>`).join("")}</tbody></table></div>` : empty("把負債也放進財務全貌", "建立房貸或其他貸款，定期記錄剩餘本金。", btn("新增貸款", "loan", true))}</section><p class="subtitle">貸款以餘額快照追蹤；利率供參考，不會自動計息或預估還款。</p>`;
}
function goalPage() {
  return `<section class="panel"><div class="panel-head"><h2>每一步，都是累積</h2><small>全部以 TWD 設定</small></div>${goalsList()}</section>`;
}
function holderPage() {
  const holders = state.holders.filter(
    (h) => holder === "all" || h.id === holder,
  );
  return holders.length
    ? `<div class="holder-cards">${holders
        .map((h) => {
          const t = totals(asOf, h.id);
          return `<section class="panel holder-card"><h2>${esc(h.name)}</h2><p>總資產<strong>NT$ ${fmt(t.value)}</strong></p><p>投入本金<strong>NT$ ${fmt(t.cost)}</strong></p><p>貸款餘額<strong>NT$ ${fmt(t.debt)}</strong></p><p>淨資產<strong>NT$ ${fmt(t.net)}</strong></p><p>投資帳戶<strong>${state.accounts.filter((a) => a.holder_id === h.id).length} 個</strong></p></section>`;
        })
        .join("")}</div>`
    : empty(
        "從一位持有人開始",
        "持有人可以是自己、伴侶或家庭成員。",
        btn("新增持有人", "holder", true),
      );
}
function decorate() {
  document
    .querySelectorAll("[data-color]")
    .forEach((el) => (el.style.background = el.dataset.color));
  document
    .querySelectorAll("[data-progress]")
    .forEach((el) => (el.style.width = el.dataset.progress + "%"));
  const d = $("#allocation-data");
  if (d) {
    const s = JSON.parse(d.textContent);
    $("#allocation-donut").style.background = s.some((v) => v.p)
      ? `conic-gradient(${s.map((v) => `${v.color} ${v.start}% ${v.end}%`).join(",")})`
      : "#eef1e9";
  }
}
new MutationObserver(() => decorate()).observe(app, {
  childList: true,
  subtree: false,
});
function field(label, name, type = "text", value = "", options = {}) {
  const opts = options.options;
  return `<label class="field ${options.wide ? "wide" : ""}">${label}${opts ? `<select name="${name}" ${options.required === false ? "" : "required"}>${opts.map((o) => `<option value="${esc(typeof o === "object" ? o.value : o)}" ${String(typeof o === "object" ? o.value : o) === String(value) ? "selected" : ""}>${esc(typeof o === "object" ? o.label : o)}</option>`).join("")}</select>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${options.required === false ? "" : "required"} ${type === "number" ? `min="0" step="${options.step || "0.01"}"` : ""} ${type === "date" ? `max="${options.future ? "9999-12-31" : today()}"` : ""} ${options.readonly ? "readonly" : ""} ${type === "text" ? 'maxlength="120"' : ""}>`}${options.help ? `<small>${options.help}</small>` : ""}</label>`;
}
const holderField = () =>
  field(
    "歸屬持有人",
    "holderId",
    "",
    holder === "all" ? state.holders[0]?.id : holder,
    { options: state.holders.map((h) => ({ value: h.id, label: h.name })) },
  );
const currencyField = () =>
  field("幣別", "currency", "", "TWD", { options: ["TWD", "USD", "JPY"] });
const rateField = (name = "rate", value = 1) =>
  field(
    (name === "fromRate" ? "轉出" : name === "toRate" ? "轉入" : "") +
      "匯率（1 外幣 = ? TWD）",
    name,
    "number",
    value,
    {
      step: "0.000001",
      help: "台幣固定為 1；外幣請輸入記錄當日匯率。",
    },
  );
const accountField = (name = "accountId", value = "") =>
  field(
    name === "fromId" ? "轉出帳戶" : name === "toId" ? "轉入帳戶" : "投資帳戶",
    name,
    "",
    value || state.accounts[0]?.id,
    {
      wide: name === "accountId",
      options: state.accounts.map((a) => ({
        value: a.id,
        label: `${a.name} · ${holderName(a.holder_id)} · ${a.currency}`,
      })),
    },
  );
function openForm(title, fields, endpoint, note = "", extra = {}) {
  modal.classList.remove("large");
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${title}</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><form class="modal-body" id="entry-form">${note ? `<p class="form-note">${note}</p>` : ""}<div class="form-grid">${fields}</div><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button" data-close>取消</button><button class="button primary" type="submit">儲存記錄</button></div></form>`;
  if (!modal.open) modal.showModal();
  const form = $("#entry-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const b = { ...Object.fromEntries(new FormData(form)), ...extra };
    if (b.principal === "") delete b.principal;
    form.querySelector("[type=submit]").disabled = true;
    try {
      await api(endpoint, b);
      await refresh();
      modal.close();
      toast("記錄已儲存");
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
      if (err.message.includes("重新整理")) {
        try {
          await refresh();
        } catch {}
      }
    } finally {
      busy = false;
      form.querySelector("[type=submit]").disabled = false;
    }
  });
  return form;
}
function wireRates(form) {
  const sync = () => {
    const curr =
      form.elements.currency?.value ||
      state.accounts.find((a) => a.id === form.elements.accountId?.value)
        ?.currency;
    if (form.elements.rate && curr) {
      form.elements.rate.readOnly = curr === "TWD";
      form.elements.rate.value =
        curr === "TWD"
          ? 1
          : state.accounts.find((a) => a.id === form.elements.accountId?.value)
            ? accountState(
                state.accounts.find(
                  (a) => a.id === form.elements.accountId.value,
                ),
                state.events,
              ).rate / FX
            : "";
    }
  };
  form.elements.currency?.addEventListener("change", sync);
  form.elements.accountId?.addEventListener("change", sync);
  sync();
}
function needHolders() {
  if (!state.holders.length) {
    toast("請先新增一位持有人");
    showForm("holder");
    return false;
  }
  return true;
}
function showForm(kind, id) {
  if (["account", "loan", "goal"].includes(kind) && !needHolders()) return;
  if (
    ["valuation", "deposit", "withdrawal"].includes(kind) &&
    !state.accounts.length
  ) {
    toast("請先建立投資帳戶");
    showForm("account");
    return;
  }
  let f;
  if (kind === "holder") {
    openForm(
      "新增持有人",
      field("姓名 / 帳號名稱", "name", "text", "", { wide: true }),
      "holders",
      "持有人用來分別管理資產；資料僅限目前的 Google 登入者存取。",
    );
    return;
  }
  if (kind === "account") {
    f = openForm(
      "新增投資帳戶",
      field("帳戶名稱", "name", "text", "", { wide: true }) +
        holderField() +
        field("帳戶類型", "type", "", "股票", { options: types }) +
        currencyField() +
        field("開戶 / 起始日期", "date", "date", today()) +
        field("投入本金（原幣）", "principal", "number", 0) +
        field("帳戶價值（原幣）", "value", "number", 0) +
        rateField(),
      "accounts",
      "匯率會用於換算起始本金的台幣成本。後續估值只更新市值，不改變投入本金。",
    );
    wireRates(f);
    return;
  }
  if (["valuation", "deposit", "withdrawal"].includes(kind)) {
    f = openForm(
      kindNames[kind],
      accountField("accountId", id) +
        field("記錄日期", "date", "date", today()) +
        field(
          kind === "valuation" ? "帳戶總價值（原幣）" : "金額（原幣）",
          "amount",
          "number",
          "",
        ) +
        rateField() +
        (kind === "withdrawal"
          ? field("提領本金（原幣，可留白）", "principal", "number", "", {
              required: false,
              help: "預設為提領金額，最多扣至剩餘本金；獲利提領可填 0。",
            })
          : "") +
        field("備註", "note", "text", "", { wide: true, required: false }),
      "events",
      kind === "valuation"
        ? "輸入當日帳戶的完整總價值，並非漲跌金額。同日多筆記錄依建立順序計算。"
        : "投入增加本金與價值；提領減少價值並按指定本金扣除成本。",
      { kind },
    );
    wireRates(f);
    return;
  }
  if (kind === "transfer") {
    if (state.accounts.length < 2) {
      toast("請先建立至少兩個帳戶");
      return;
    }
    f = openForm(
      "帳戶資金移轉",
      accountField("fromId", state.accounts[0].id) +
        accountField("toId", state.accounts[1].id) +
        field("移轉日期", "date", "date", today()) +
        field("轉出金額（原幣）", "amount", "number", "") +
        field("移轉本金（轉出原幣，可留白）", "principal", "number", "", {
          required: false,
          help: "預設為轉出金額，最多為剩餘本金。可自行指定。",
        }) +
        field("實際轉入金額（轉入原幣）", "received", "number", "") +
        rateField("fromRate") +
        rateField("toRate") +
        field("轉入本金（轉入原幣）", "targetPrincipal", "number", "", {
          help: "跨幣別請填寫對應本金；原始台幣成本仍保持不變。",
        }) +
        field("備註", "note", "text", "", { required: false }),
      "transfers",
      "兩個帳戶的價值與本金會一起儲存。同幣別轉入等於轉出；跨幣別請填實收金額。移轉後的資產變化也可能反映費用與匯率差異。",
      { requestKey: crypto.randomUUID() },
    );
    const sync = () => {
      const a = state.accounts.find((a) => a.id === f.elements.fromId.value),
        b = state.accounts.find((a) => a.id === f.elements.toId.value),
        same = a.currency === b.currency;
      for (const [name, account] of [
        ["fromRate", a],
        ["toRate", b],
      ]) {
        f.elements[name].readOnly = account.currency === "TWD";
        f.elements[name].value = accountState(account, state.events).rate / FX;
      }
      for (const name of ["received", "targetPrincipal"]) {
        f.elements[name].readOnly = same;
        f.elements[name].required = !same;
      }
      f.elements.received.value = same ? f.elements.amount.value : "";
      f.elements.targetPrincipal.value = same ? "0" : "";
    };
    f.elements.fromId.onchange = sync;
    f.elements.toId.onchange = sync;
    f.elements.amount.oninput = () => {
      if (f.elements.received.readOnly)
        f.elements.received.value = f.elements.amount.value;
    };
    sync();
    return;
  }
  if (kind === "loan") {
    f = openForm(
      "新增貸款",
      field("貸款名稱", "name", "text", "", { wide: true }) +
        holderField() +
        currencyField() +
        field("年利率（%）", "annualRate", "number", "") +
        field("記錄日期", "date", "date", today()) +
        field("剩餘本金（原幣）", "balance", "number", "") +
        rateField(),
      "loans",
    );
    wireRates(f);
    return;
  }
  if (kind === "loan-balance") {
    const l = state.loans.find((l) => l.id === id),
      last = loansAt(today(), "all").find((v) => v.id === id);
    f = openForm(
      "更新貸款餘額 · " + l.name,
      field("記錄日期", "date", "date", today()) +
        field(
          "剩餘本金（" + l.currency + "）",
          "balance",
          "number",
          last.balance / 100,
        ) +
        rateField("rate", last.rate / FX) +
        field("備註", "note", "text", "", { required: false, wide: true }),
      "loan-balances",
      "請輸入完整剩餘本金，並非本期還款金額。",
      { loanId: id },
    );
    if (l.currency === "TWD") f.elements.rate.readOnly = true;
    return;
  }
  if (kind === "goal") {
    openForm(
      "設定資產目標",
      field("目標名稱", "name", "text", "", { wide: true }) +
        holderField() +
        field("目標基準", "basis", "", "assets", {
          options: [
            { value: "assets", label: "總資產" },
            { value: "net", label: "淨資產（扣除貸款）" },
          ],
        }) +
        field("目標金額（TWD）", "target", "number", "") +
        field(
          "目標日期",
          "date",
          "date",
          `${Number(today().slice(0, 4)) + 1}-12-31`,
          { future: true },
        ),
      "goals",
      "進度依目前檢視日期的最新記錄計算；目標幣別固定為台幣。",
    );
  }
}
function detail(id) {
  const a = accountState(
      state.accounts.find((a) => a.id === id),
      state.events,
      asOf,
    ),
    events = state.events
      .filter((e) => e.account_id === id && e.date <= asOf)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  modal.classList.add("large");
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${esc(a.name)}</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><div class="modal-body"><p class="subtitle">${esc(holderName(a.holder_id))} · ${a.currency} · 截至 ${asOf}</p><div class="detail-summary"><div>投入本金<strong>${fmt(a.cost, 2)}</strong></div><div>帳戶價值<strong>${fmt(a.value, 2)}</strong></div><div>歷史台幣成本<strong>${fmt(a.costTwd)}</strong></div></div><div class="actions"><button class="button primary" data-entry="valuation" data-account="${id}">記錄估值</button><button class="button" data-entry="deposit" data-account="${id}">投入資金</button><button class="button" data-entry="withdrawal" data-account="${id}">提領資金</button></div><div class="table-wrap"><table class="history-table"><thead><tr><th>日期 / 類型</th><th class="num">價值 / 異動</th><th class="num">本金異動</th><th class="num">匯率</th><th>備註</th><th></th></tr></thead><tbody>${events.map((e) => `<tr><td>${e.date}<small>${kindNames[e.kind]}</small></td><td class="num">${fmt(e.amount, 2)}</td><td class="num">${fmt(e.cost_delta, 2)}</td><td class="num">${e.rate / FX}</td><td>${esc(e.note)}</td><td>${["valuation", "deposit", "withdrawal"].includes(e.kind) ? `<button class="link-button danger" data-delete-table="events" data-delete-id="${e.id}" data-reopen="${id}">刪除</button>` : ""}</td></tr>`).join("")}</tbody></table></div><p class="subtitle">估值為完整價值，其餘記錄為增減金額。更正記錄可刪除後重新建立；開戶與移轉記錄保留作為資金軌跡。</p></div>`;
  modal.showModal();
}
function loanHistory(id) {
  const l = state.loans.find((l) => l.id === id),
    rows = state.loan_balances
      .filter((r) => r.loan_id === id && r.date <= asOf)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  modal.classList.add("large");
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${esc(l.name)} · 餘額歷史</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><div class="modal-body"><div class="table-wrap"><table><thead><tr><th>日期</th><th>餘額（${l.currency}）</th><th>匯率</th><th>備註</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.date}</td><td>${fmt(r.balance, 2)}</td><td>${r.rate / FX}</td><td>${esc(r.note)}</td><td><button class="link-button danger" data-delete-table="loan_balances" data-delete-id="${r.id}" data-loan-reopen="${id}">刪除</button></td></tr>`).join("")}</tbody></table></div></div>`;
  modal.showModal();
}
async function login() {
  const messages = {
    config: "尚未設定 Google 登入，請設定 Google Client ID 與 Client Secret。",
    state: "登入驗證已失效，請重新登入。",
    cancelled: "已取消 Google 登入。",
    domain: "只允許 @mrandmrsjian.com 的 Google Workspace 帳號。",
    failed: "Google 驗證失敗，請重新登入。",
  };
  const error = new URLSearchParams(location.search).get("auth_error");
  app.innerHTML = `<div class="login"><section class="login-story">${brand()}<h1>為現在的累積，<br>看見未來的輪廓。</h1><p>投資帳戶、跨幣別資產、貸款與目標，<br>在一個安靜清楚的地方，慢慢理好。</p></section><section class="login-box"><div class="eyebrow">WELCOME HOME</div><h2>歡迎回到家計</h2><p>${config.dev ? "直接進入本機預覽，<br>繼續追蹤每一份資產。" : "使用你的 Google 帳號登入，<br>繼續追蹤每一份資產。"}</p>${config.dev ? '<button class="button primary" data-action="local">以測試成員進入</button>' : config.googleConfigured ? '<a class="button primary" href="/auth/google">使用 Google 帳號登入</a>' : '<div class="notice">尚未設定 Google 登入。請依 README 設定 Google Client ID、Client Secret 與回呼網址。</div>'}<div class="error-text" role="alert">${esc(messages[error] || "")}</div><div class="login-caption">${config.dev ? "本機預覽免 Google 驗證，僅使用本機測試資料。" : "僅開放 @mrandmrsjian.com 的 Google Workspace 帳號。<br>每位登入者的財務資料分開儲存。"}</div></section></div>`;
}
async function sample() {
  if (!config.dev) return;
  if (state.accounts.length || state.holders.length) {
    toast("示範資料僅能在空白的本機資料庫建立");
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const post = async (p, b) => {
      await api(p, b);
      state = await api("state");
    };
    await post("holders", { name: "示範 · 子安" });
    const h = state.holders[0].id;
    await post("holders", { name: "示範 · 佳寧" });
    const h2 = state.holders.find((v) => v.id !== h).id;
    const start = today().slice(0, 4) + "-01-01";
    for (const a of [
      {
        name: "台股長期投資",
        holderId: h,
        type: "股票",
        currency: "TWD",
        principal: 3000000,
        value: 3180000,
        rate: 1,
      },
      {
        name: "美股成長帳戶",
        holderId: h,
        type: "美股",
        currency: "USD",
        principal: 60000,
        value: 67000,
        rate: 32,
      },
      {
        name: "期貨交易帳戶",
        holderId: h2,
        type: "期貨",
        currency: "TWD",
        principal: 500000,
        value: 545000,
        rate: 1,
      },
      {
        name: "未上市公司投資",
        holderId: h2,
        type: "未上市公司",
        currency: "JPY",
        principal: 1000000,
        value: 1050000,
        rate: 0.21,
      },
    ])
      await post("accounts", { ...a, date: start });
    for (const month of ["03", "06", "09"]) {
      const day = today().slice(0, 4) + "-" + month + "-01";
      if (day > today()) continue;
      for (const a of state.accounts) {
        const base = state.events.find(
          (e) => e.account_id === a.id && e.kind === "opening",
        );
        const factor = 1 + Number(month) * 0.014;
        await post("events", {
          accountId: a.id,
          kind: "valuation",
          date: day,
          amount: Math.round((base.amount / 100) * factor),
          rate: base.rate / FX,
          note: "示範估值",
        });
      }
    }
    await post("loans", {
      holderId: h,
      name: "示範住宅房貸",
      currency: "TWD",
      annualRate: 2.2,
      date: start,
      balance: 1800000,
      rate: 1,
    });
    await post("goals", {
      holderId: h,
      name: "資產千萬計畫",
      target: 10000000,
      date: `${Number(today().slice(0, 4)) + 2}-12-31`,
      basis: "assets",
    });
    await post("goals", {
      holderId: h2,
      name: "第一個兩百萬",
      target: 2000000,
      date: `${Number(today().slice(0, 4)) + 1}-12-31`,
      basis: "net",
    });
    render();
    toast("已建立本機示範資料");
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  try {
    if (t.hasAttribute("data-close")) {
      modal.close();
      return;
    }
    if (t.dataset.page) {
      page = t.dataset.page;
      render();
      return;
    }
    if (t.dataset.holder) {
      holder = t.dataset.holder;
      render();
      return;
    }
    if (t.dataset.detail) {
      detail(t.dataset.detail);
      return;
    }
    if (t.dataset.loan) {
      showForm("loan-balance", t.dataset.loan);
      return;
    }
    if (t.dataset.loanHistory) {
      loanHistory(t.dataset.loanHistory);
      return;
    }
    if (t.dataset.entry) {
      showForm(t.dataset.entry, t.dataset.account);
      return;
    }
    if (t.dataset.deleteTable) {
      if (!confirm("確定刪除這筆記錄？刪除後會重新計算受影響的資料。")) return;
      if (busy) return;
      busy = true;
      try {
        await api("delete", {
          table: t.dataset.deleteTable,
          id: ["events", "loan_balances"].includes(t.dataset.deleteTable)
            ? Number(t.dataset.deleteId)
            : t.dataset.deleteId,
        });
        await refresh();
        modal.close();
        if (t.dataset.reopen) detail(t.dataset.reopen);
        if (t.dataset.loanReopen) loanHistory(t.dataset.loanReopen);
        toast("記錄已刪除");
      } finally {
        busy = false;
      }
      return;
    }
    const a = t.dataset.action;
    if (a === "logout") {
      await api("auth/logout", {});
      state = null;
      config = await api("config");
      login();
    } else if (a === "export") {
      const data = await api("export"),
        blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `finance-backup-${today()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (a === "sample") await sample();
    else if (a === "local") await refresh();
    else if (a) showForm(a);
  } catch (err) {
    toast(err.message);
  }
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      modal.close();
  }
});
try {
  config = await api("config");
  if (config.dev) login();
  else {
    try {
      await refresh();
    } catch {
      login();
    }
  }
} catch (e) {
  app.innerHTML = `<div class="loading"><div><h2>暫時無法載入</h2><p>${esc(e.message)}</p><p>請確認本機設定與 D1 資料庫遷移已完成，再重新整理。</p></div></div>`;
}
