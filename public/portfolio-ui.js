import { FX } from "./domain.js";
import { SCALE } from "./portfolio-domain.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const amount = (v, currency = "TWD") =>
  new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: currency === "USD" ? 2 : 0,
    minimumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(v / 100);
const micro = (v) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 6 }).format(
    v / SCALE,
  );
const timeLabel = (v) =>
  esc(
    new Date(v).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    }),
  );
const marketNames = { TWSE: "上市", TPEX: "上櫃", US: "美股" };
export const portfolioEligible = (a) =>
  (a.type === "股票" && a.currency === "TWD") ||
  (a.type === "美股" && a.currency === "USD");
export function estimateTable(e) {
  return `<div class="table-wrap"><table class="history-table"><thead><tr><th>市場 / 代號</th><th class="num">持有股數</th><th class="num">單價</th><th>價格日期 / 來源</th><th class="num">市值（原幣）</th></tr></thead><tbody>${e.holdings.map((h) => `<tr><td>${marketNames[h.market]} · ${esc(h.symbol)}</td><td class="num">${micro(h.quantity)}</td><td class="num">${h.price ? micro(h.price) : "缺少價格"}</td><td>${h.priceDate || "—"}<small>${esc(h.source || "尚無行情")}</small>${h.warning ? `<small class="danger">${esc(h.warning)}</small>` : ""}</td><td class="num">${h.value === null ? "—" : amount(h.value, e.currency)}</td></tr>`).join("")}</tbody></table></div>`;
}
export function portfolioPanel(a, p, e) {
  if (!portfolioEligible(a)) return "";
  if (!p || p.mode !== "holdings")
    return `<section class="portfolio-panel"><div class="panel-head"><h3>估值方式：手動帳戶總值</h3><button class="link-button" data-portfolio-edit="${a.id}">設定現金＋持股</button></div></section>`;
  return `<section class="portfolio-panel"><div class="panel-head"><h3>目前持股估算</h3><div class="actions"><button class="link-button" data-portfolio-refresh="${a.id}">更新行情</button><button class="link-button" data-portfolio-edit="${a.id}">編輯現金／持股</button></div></div>${!e ? '<p class="subtitle">尚無完整持股估算，正在取得行情；完成後會保存目前估算。</p>' : `<div class="portfolio-numbers"><div>現金（${a.currency}）<strong>${amount(e.cash, e.currency)}</strong></div><div>估算總值（${a.currency}）<strong>${e.complete ? amount(e.total, e.currency) : "估值不完整"}</strong></div><div>折合台幣<strong>${e.complete ? "NT$ " + amount(e.totalTwd) : "—"}</strong></div></div><p class="subtitle">現金／股數資料日 ${e.dataDate} · 1 ${a.currency} = ${e.rate / FX} TWD${a.currency !== "TWD" ? `<br>匯率日期 ${e.fxDate || "原記錄未提供"} · ${esc(e.fxSource || "帳戶原有匯率")}${e.fxWarning ? `<br><span class="danger">${esc(e.fxWarning)}</span>` : ""}` : ""}<br>估算最後更新 ${timeLabel(e.estimatedAt)}（台北時間）${e.updateWarning ? `<br><span class="portfolio-warning">${esc(e.updateWarning)}</span>` : ""}</p>${e.warning && !e.pending ? '<p class="portfolio-warning">部分行情或匯率較舊／更新失敗，請確認資料日期後再儲存。</p>' : ""}${e.pending ? '<p class="portfolio-warning">正在分批更新行情，完成後即可查看完整總值。</p>' : !e.complete ? '<p class="portfolio-warning">有持股缺少價格，尚無法計算完整總值。請確認市場與代號，或稍後更新行情；不會將缺價股票算成零。</p>' : ""}${estimateTable(e)}<div class="portfolio-save"><small>目前估算不會自動寫入歷史；投入本金不變。資金移轉前請先儲存估值。</small><button class="button primary" data-portfolio-save="${a.id}" ${e.complete ? "" : "disabled"}>${e.complete && e.warning ? "儲存估值（含舊行情）" : "儲存今日估值快照"}</button></div>`}</section>`;
}
export function openPortfolioEditor({
  account,
  portfolio,
  holdings,
  api,
  onSaved,
}) {
  const modal = document.querySelector("#modal"),
    content = document.querySelector("#modal-content");
  modal.classList.remove("transfer-dialog");
  modal.classList.add("large");
  const p = portfolio || {
    mode: "manual",
    cash: 0,
  };
  content.innerHTML = `<div class="modal-head"><h2>${esc(account.name)} · 估值設定</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><form class="modal-body" id="portfolio-form"><p class="form-note">買賣、配息、拆股後，請一起更新現金與股數。此設定不會改變投入本金，也不會重寫歷史估值。</p><label class="field">估值方式<select name="mode"><option value="manual" ${p.mode === "manual" ? "selected" : ""}>手動輸入帳戶總值</option><option value="holdings" ${p.mode === "holdings" ? "selected" : ""}>現金＋持股自動估算</option></select></label><div class="portfolio-composition"><div class="form-grid portfolio-editor-meta"><label class="field">現金餘額（${account.currency}）<input name="cash" type="number" min="0" step="0.01" value="${p.cash / 100}" required></label></div><div class="panel-head"><h3>目前持股</h3><button type="button" class="button" data-add-holding>＋ 新增股票</button></div><p class="subtitle">股數以「股」為單位，可填小數股；價格自動取得。</p><div id="holding-rows"></div><p class="subtitle">行情暫時無法取得時，請稍後更新；估值不完整時不會儲存快照。</p></div><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button" data-close>取消</button><button type="submit" class="button primary">儲存設定</button></div></form>`;
  const form = content.querySelector("form"),
    rows = form.querySelector("#holding-rows");
  let submitting = false;
  const add = (h = {}) => {
    const el = document.createElement("div");
    el.className = "holding-editor-row";
    const markets = account.currency === "USD" ? ["US"] : ["TWSE", "TPEX"];
    el.innerHTML = `<div class="holding-editor-fields"><label class="field">市場<select data-field="market">${markets.map((m) => `<option value="${m}" ${h.market === m ? "selected" : ""}>${marketNames[m]}</option>`).join("")}</select></label><label class="field">股票代號<input data-field="symbol" value="${esc(h.symbol || "")}" maxlength="15" placeholder="${account.currency === "USD" ? "AAPL" : "2330"}" required></label><label class="field">持有股數<input data-field="quantity" type="number" min="0.000001" step="0.000001" value="${h.quantity ? h.quantity / SCALE : ""}" required></label><button type="button" class="link-button danger" data-remove-holding aria-label="移除此持股">移除</button></div>`;
    el.querySelector("[data-remove-holding]").onclick = () => el.remove();
    rows.append(el);
  };
  holdings.forEach(add);
  form.querySelector("[data-add-holding]").onclick = () => {
    if (rows.children.length >= 100) {
      form.querySelector(".form-error").textContent = "最多 100 檔持股";
      return;
    }
    add();
  };
  const syncMode = () => {
    const active = form.elements.mode.value === "holdings";
    form.querySelector(".portfolio-composition").hidden = !active;
    form
      .querySelectorAll(
        ".portfolio-composition input,.portfolio-composition select,.portfolio-composition button",
      )
      .forEach((el) => (el.disabled = !active));
  };
  form.elements.mode.onchange = syncMode;
  syncMode();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    form.querySelector(".form-error").textContent = "";
    try {
      const body = {
        accountId: account.id,
        mode: form.elements.mode.value,
        cash: form.elements.cash.value,
        holdings: [...rows.children].map((row) =>
          Object.fromEntries(
            [...row.querySelectorAll("[data-field]")].map((el) => [
              el.dataset.field,
              el.value,
            ]),
          ),
        ),
      };
      await api("portfolio", body);
      modal.close();
      await onSaved();
    } catch (e) {
      form.querySelector(".form-error").textContent = e.message;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  };
  if (!modal.open) modal.showModal();
}
export function openSnapshot(snapshot) {
  const e = JSON.parse(snapshot.details_json),
    modal = document.querySelector("#modal");
  modal.classList.remove("transfer-dialog");
  modal.classList.add("large");
  document.querySelector("#modal-content").innerHTML =
    `<div class="modal-head"><h2>已儲存的持股估值快照</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><div class="modal-body"><p class="form-note">這是儲存當下的現金、股數、價格與匯率，之後行情變動不會改寫此紀錄。</p><div class="portfolio-numbers"><div>現金（${e.currency}）<strong>${amount(e.cash, e.currency)}</strong></div><div>總值（${e.currency}）<strong>${amount(e.total, e.currency)}</strong></div><div>匯率<strong>${e.rate / FX}</strong></div></div><p class="subtitle">${e.currency !== "TWD" ? `匯率日期 ${e.fxDate || "原記錄未提供"} · ${esc(e.fxSource || "帳戶原有匯率")}${e.fxWarning ? `<br>${esc(e.fxWarning)}` : ""}<br>` : ""}股數／現金資料日 ${e.dataDate} · 估算時間 ${timeLabel(e.estimatedAt)}（台北時間）</p>${estimateTable(e)}</div>`;
  if (!modal.open) modal.showModal();
}
