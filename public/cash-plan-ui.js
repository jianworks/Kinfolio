import { forecast, monthsFrom, rollPlan } from "./cash-plan-domain.js";
import { money, today } from "./domain.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(
        n / 100,
      );
const rowIcon = (kind) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
 edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
 done: '<path d="m5 12 4 4L19 6"/>',
 fill: '<rect x="3" y="3" width="6" height="18" rx="1"/><path d="M12 7h9m-3-3 3 3-3 3M12 14h9M12 18h9"/>',
 remove: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
}[kind]}</svg>`;
let draft = null,
  dirty = false,
  saving = false,
  editingRow = null;
let rolloverTimer;
export function resetCashDraft() {
  draft = null;
  dirty = false;
  editingRow = null;
}
export function mountCashPlan({ root, saved, save, toast }) {
  if (!draft)
    draft = saved
      ? JSON.parse(saved.payload)
      : {
          start: monthsFrom(today().slice(0, 7))[0],
          opening: 0,
          floor: 0,
          items: [],
        };
  const currentMonth = today().slice(0,7);
  if (draft.start < currentMonth) { draft=rollPlan(draft,currentMonth); dirty=true; editingRow=null; }
  clearInterval(rolloverTimer);
  rolloverTimer=setInterval(()=>{
    if (!root.isConnected) { clearInterval(rolloverTimer); return; }
    const month=today().slice(0,7);
    if (!saving && !document.querySelector('#modal').open && draft.start<month) {
      draft=rollPlan(draft,month); dirty=true;editingRow=null;draw();
    }
  },30000);
  document.querySelector('#cash-settings-open').onclick = () => {
    const dialog = document.querySelector('#modal');
    delete dialog.dataset.detailAccount;
    dialog.classList.remove('transfer-dialog');
    dialog.querySelector('#modal-content').innerHTML = `<form id="cash-settings-form"><h2>設定現金規劃</h2><p>設定現金基準與預測期間，所有金額皆為台幣。</p><div class="cash-fields"><label>起始月份<input name="start" type="month" min="${draft.start}" required value="${draft.start}"></label><label>期初可用現金<input name="opening" type="number" min="0" step="0.01" required value="${draft.opening/100}"></label><label>每月安全底線<input name="floor" type="number" min="0" step="0.01" required value="${draft.floor/100}"></label></div><p>期初現金是起始月份開始前的餘額。換月會保留相同月份的收支，已過月份的規劃複製至次年同月；期初現金請依新期間重新確認。</p><p role="alert" id="cash-settings-error"></p><div class="actions"><button type="button" id="cash-settings-cancel" class="button">取消</button><button class="button primary" type="submit">儲存設定</button></div><p>儲存設定時也會一併儲存目前收支表的變更。</p></form>`;
    const form=dialog.querySelector('form');
    form.querySelector('#cash-settings-cancel').onclick=()=>dialog.close();
    form.onsubmit=async e=>{
      e.preventDefault();
      if(saving)return;
      const submit=form.querySelector('[type="submit"]');
      try {
        const candidate={...rollPlan(draft,form.elements.start.value),opening:money(form.elements.opening.value),openingMonth:form.elements.start.value,floor:money(form.elements.floor.value)};
        forecast(candidate);
        saving=true; submit.disabled=true; submit.textContent='儲存中…';
        await save(candidate);
        draft=candidate; saved={payload:JSON.stringify(candidate)}; dirty=false;editingRow=null;
        saving=false;dialog.close();draw();toast('現金規劃設定已儲存');
      }catch(err){form.querySelector('#cash-settings-error').textContent=err.message;}
      finally{saving=false;submit.disabled=false;submit.textContent='儲存設定';}
    };
    dialog.showModal();
  };
  function draw() {
    const months = monthsFrom(draft.start);
    root.innerHTML = `<div id="cash-results"></div><section class="panel cash-editor"><div class="cash-toolbar"><div><h2>未來 12 個月收支</h2><p>按右側鉛筆圖示編輯該列。空白金額自動以 0 計算。</p></div><div class="actions"><button class="button" data-cash="income">＋ 收入</button><button class="button" data-cash="expense">＋ 支出</button><button class="button primary" data-cash="save" ${saving ? "disabled" : ""}>${saving ? "儲存中…" : "儲存規劃"}</button></div></div><p id="cash-save-status" role="status"></p><div class="cash-scroll"><table class="cash-table"><thead><tr><th>項目</th>${months.map((m) => `<th>${m}</th>`).join("")}<th class="cash-total-heading">全年合計</th><th class="cash-actions-heading">操作</th></tr></thead><tbody>${draft.items
      .map((item, i) => {
        const editing = editingRow === i;
        return `<tr class="cash-row-${item.direction} ${editing ? "cash-row-editing" : ""}"><th>${editing ? `<input aria-label="項目名稱" data-name="${i}" maxlength="40" value="${esc(item.name)}">` : esc(item.name)}</th>${item.values.map((v, j) => `<td>${editing ? `<input aria-label="${esc(item.name)} ${months[j]} 金額" type="number" min="0" step="0.01" data-row="${i}" data-col="${j}" value="${v === null || v === 0 ? "" : v / 100}" placeholder="">` : v === null || v === 0 ? "" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(v / 100)}</td>`).join("")}<td class="cash-row-total" data-total="${i}"></td><td class="cash-row-actions"><button class="link-button" data-edit="${i}" aria-label="${editing ? "完成編輯" : "編輯"} ${esc(item.name)}" title="${editing ? "完成編輯" : "編輯"}">${rowIcon(editing ? "done" : "edit")}</button><button class="link-button" data-fill="${i}" aria-label="首月金額套用全年 ${esc(item.name)}" title="首月金額套用全年">${rowIcon("fill")}</button><button class="link-button" data-remove="${i}" aria-label="刪除 ${esc(item.name)}" title="刪除">${rowIcon("remove")}</button></td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div>${draft.items.length ? "" : '<div class="empty"><strong>先加入收入與支出</strong><p>例如薪資、獎金、房貸、生活費與旅遊費。</p><button class="button" data-cash="example">載入虛構範例</button></div>'}</section>`;
    update();
  }
  function update() {
    draft.items.forEach((item, index) => {
      const total = item.values.reduce((sum, value) => sum + (value ?? 0), 0);
      root.querySelector(`[data-total="${index}"]`).textContent =
        new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(total / 100);
    });
    const status = root.querySelector("#cash-save-status");
    status.textContent = dirty
      ? "有未儲存的變更"
      : saved
        ? "已儲存的規劃"
        : "尚未儲存";

    try {
      const r = forecast(draft);
      root.querySelector("#cash-results").innerHTML =
        `${draft.openingMonth && draft.openingMonth !== draft.start ? '<div class="notice">收支已按月份滾動，新增月份沿用去年同月規劃。期初現金仍是舊期間的設定，請按「設定現金規劃」確認目前現金後儲存。</div>' : ""}<div class="cash-plan-context"><span>規劃期間 <strong>${draft.start} ～ ${monthsFrom(draft.start)[11]}</strong></span><span>期初現金 NT$ ${fmt(draft.opening)}</span><span>安全底線 NT$ ${fmt(draft.floor)}</span></div><div class="cash-stats"><div class="panel cash-annual-combined"><span>未來 12 個月收支</span><div><small>總收入</small><strong class="cash-income-total">NT$ ${fmt(r.rows.reduce((sum,row)=>sum+row.income,0))}</strong></div><div><small>總支出</small><strong class="cash-expense-total">NT$ ${fmt(r.rows.reduce((sum,row)=>sum+row.expense,0))}</strong></div></div>${[
          ["應保留現金", r.required, "涵蓋規劃期間，向上取整至萬元"],
          [
            r.shortfall ? "待補足現金" : "可動用現金",
            r.shortfall || r.available,
            "依期初現金與安全底線估算",
          ],
          [
            "首次低於底線",
            null,
            r.firstLow || (r.complete ? "規劃期間內無缺口" : "請補齊收支資料"),
          ],
        ]
          .map(
            ([label, n, foot], i) =>
              `<div class="panel"><span>${label}</span><strong>${i === 2 ? r.firstLow || "—" : "NT$ " + fmt(n)}</strong><small>${foot}</small></div>`,
          )
          .join(
            "",
          )}</div>${!r.complete ? '<div class="notice">請新增收入或支出項目，開始估算現金流。</div>' : ""}${chart(r.rows, draft.floor)}<details class="panel cash-summary"><summary>逐月現金預測明細</summary><div class="cash-scroll"><table class="cash-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>月淨流量</th><th>預測月底現金</th><th>高於／低於底線</th></tr></thead><tbody>${r.rows.map((x) => `<tr><th>${x.month}</th><td>${fmt(x.income)}</td><td>${fmt(x.expense)}</td><td>${fmt(x.net)}</td><td class="${x.balance !== null && x.balance < draft.floor ? "cash-negative" : ""}">${fmt(x.balance)}</td><td>${fmt(x.balance === null ? null : x.balance - draft.floor)}</td></tr>`).join("")}</tbody></table></div></details>`;
    } catch (e) {
      root.querySelector("#cash-results").innerHTML =
        `<div class="notice" role="alert">${esc(e.message)}</div>`;
    }
  }
  root.oninput = (e) => {
    const t = e.target;
    try {
      if (t.dataset.setting) {
        const k = t.dataset.setting;
        if (k === "start") {
          return;
        }
        draft[k] = money(t.value);
      } else if (t.dataset.name !== undefined)
        draft.items[+t.dataset.name].name = t.value;
      else if (t.dataset.row !== undefined)
        draft.items[+t.dataset.row].values[+t.dataset.col] =
          t.value === "" ? 0 : money(t.value);
      else return;
      t.setCustomValidity("");
      dirty = true;
      update();
    } catch (err) {
      t.setCustomValidity(err.message);
      t.reportValidity();
    }
  };
  root.onclick = async (e) => {
    const t = e.target.closest("button");
    if (!t || saving) return;
    if (root.querySelector("input:invalid")) {
      root.querySelector("input:invalid").reportValidity();
      return;
    }
    try {
      if (t.dataset.edit !== undefined) {
        const index = +t.dataset.edit;
        if (editingRow !== null && !draft.items[editingRow].name.trim()) {
          toast("請填寫項目名稱");
          return;
        }
        if (editingRow === index) await persistPlan();
        else editingRow = index;
      } else if (t.dataset.cash === "save") {
        await persistPlan();
      } else if (["income", "expense"].includes(t.dataset.cash)) {
        if (draft.items.length >= 30) throw new Error("最多 30 個收支項目");
        draft.items.push({
          name: t.dataset.cash === "income" ? "新增收入" : "新增支出",
          direction: t.dataset.cash,
          values: Array(12).fill(0),
        });
        editingRow = draft.items.length - 1;
        dirty = true;
      } else if (t.dataset.remove !== undefined) {
        const removed = +t.dataset.remove;
        draft.items.splice(removed, 1);
        if (editingRow === removed) editingRow = null;
        else if (editingRow !== null && editingRow > removed) editingRow--;
        dirty = true;
      } else if (t.dataset.fill !== undefined) {
        const item = draft.items[+t.dataset.fill];
        item.values.fill(item.values[0] ?? 0);
        dirty = true;
      } else if (t.dataset.cash === "example") {
        editingRow = null;
        draft.opening = 10000000;
        draft.floor = 3000000;
        draft.items = [
          {
            name: "薪資（範例）",
            direction: "income",
            values: Array(12).fill(10000000),
          },
          {
            name: "生活費（範例）",
            direction: "expense",
            values: Array(12).fill(8000000),
          },
          {
            name: "旅遊（範例）",
            direction: "expense",
            values: [0, 0, 15000000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        ];
        dirty = true;
      } else return;
    } catch (err) {
      toast(err.message);
    } finally {
      saving = false;
      draw();
    }
  };
  async function persistPlan() {
    forecast(draft);
    saving = true;
    draw();
    await save(draft);
    saved = { payload: JSON.stringify(draft) };
    dirty = false;
    editingRow = null;
    toast("現金規劃已儲存");
  }
  draw();
}
function chart(rows, floor) {
  const values = rows.filter((r) => r.balance !== null);
  if (!values.length) return "";
  const low = Math.min(0, floor, ...values.map((r) => r.balance)),
    high = Math.max(floor, ...values.map((r) => r.balance), low + 100);
  const y = (n) => 160 - ((n - low) / (high - low)) * 130;
  const points = values
    .map((r, i) => `${55 + i * 60},${y(r.balance)}`)
    .join(" ");
  return `<section class="panel cash-chart"><h2>月底現金走勢</h2><p>實線：預測現金　虛線：安全底線 NT$ ${fmt(floor)}</p><svg viewBox="0 0 780 200" role="img" aria-label="未來十二個月預測月底現金與安全底線"><line x1="55" x2="735" y1="${y(floor)}" y2="${y(floor)}" stroke="var(--red, #b34f4f)" stroke-dasharray="5 5"/><polyline points="${points}" fill="none" stroke="var(--green, #205747)" stroke-width="3"/>${values.map((r, i) => `<circle cx="${55 + i * 60}" cy="${y(r.balance)}" r="4" fill="${r.balance < floor ? "var(--red, #b34f4f)" : "var(--green, #205747)"}"><title>${r.month}：NT$ ${fmt(r.balance)}</title></circle>`).join("")}${rows.map((r, i) => `<text x="${55 + i * 60}" y="190" text-anchor="middle" font-size="11" fill="var(--muted, #7a8780)">${r.month.slice(5)}月</text>`).join("")}<text x="5" y="25" font-size="11" fill="var(--muted, #7a8780)">${fmt(high)}</text><text x="5" y="165" font-size="11" fill="var(--muted, #7a8780)">${fmt(low)}</text></svg></section>`;
}
