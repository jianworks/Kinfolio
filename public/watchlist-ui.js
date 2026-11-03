const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const price = (v) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(v);
const percent = (value) =>
  value == null
    ? "—"
    : `${value > 0 ? "+" : ""}${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(Object.is(value, -0) || Math.abs(value) < 0.05 ? 0 : value)}%`;
function distanceCell(d, kind) {
  if (!d) return '<td class="num">—<small>日線不足或過舊</small></td>';
  if (!d.complete)
    return `<td class="num">—<small>僅 ${d.sessions} / 252 個交易日</small></td>`;
  const point = kind === "low" ? d.low : d.high;
  const value = kind === "low" ? d.fromLow : d.fromHigh;
  return `<td class="num watch-distance"><strong>${percent(value)}</strong><small>${kind === "low" ? "低點" : "高點"} ${price(point.price)} · ${esc(point.date)}</small><small>還原收盤 ${price(d.close)} · ${esc(d.date)}</small></td>`;
}
export function mountWatchlist({ root, api, toast }) {
  let active = true,
    rows = [],
    loading = false;
  const connected = () => active && root.isConnected;
  function render() {
    if (!connected()) return;
    root.innerHTML = `<section class="panel table-panel watch-list"><div class="panel-head"><h2>追蹤股票 <small> / ${rows.length}</small></h2><div class="actions"><button class="link-button" id="watch-refresh" ${loading ? "disabled" : ""}>${loading ? "正在更新…" : "更新行情與分析"}</button><button class="link-button" id="watch-add-open">＋ 新增追蹤股票</button></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="watch-table"><thead><tr><th>股票 / 市場</th><th class="num">最近股價（台幣）</th><th class="num">距近一年低點漲幅</th><th class="num">距近一年高點跌幅</th><th>型態階段 / 判斷理由</th><th class="num">底部支撐</th><th class="num">區間上緣</th><th>型態日線日期</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><div class="account-name"><span class="account-symbol">台</span><div>${esc(r.name || r.symbol)}<small>${esc(r.symbol)} · ${r.market === "TWSE" ? "上市" : "上櫃"}</small></div></div></td><td class="num">${price(r.price == null ? null : r.price / 1000000)}<small>${esc(r.price_date || "尚未取得")}<br>${esc(r.source || "等待更新")}</small></td>${distanceCell(r.distances, "low")}${distanceCell(r.distances, "high")}<td class="watch-analysis"><span class="watch-stage" data-stage="${esc(r.analysis.stage)}">${esc(r.analysis.stage)}</span><small>${esc(r.analysis.reason)}</small>${r.quote_error || r.history_error ? `<small class="danger">${esc([r.quote_error, r.history_error].filter(Boolean).join("；"))}</small>` : ""}</td><td class="num">${price(r.analysis.support)}${r.distances?.fromSupport != null ? `<small>距支撐 ${percent(r.distances.fromSupport)}</small>` : ""}</td><td class="num">${price(r.analysis.ceiling)}</td><td>${esc(r.analysis.date || "尚未取得")}</td><td><button class="link-button" data-watch-remove="${esc(r.id)}" aria-label="移除 ${esc(r.name || r.symbol)}">移除追蹤</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>建立你的股票觀察清單</strong><p>按右上角「＋新增追蹤股票」，開始觀察股價與築底階段。</p></div>'}</section>
    <div role="status" class="notice">每日台北時間 16:00 後分批更新還原日線；股價為最近取得行情，非即時串流。每次更新最多 5 檔，更多股票將由背景排程接續處理。支撐與區間上緣採還原股價。近一年採最近 252 個交易日的日內高低點，漲跌幅以最新還原收盤價計算，與盤中最近股價的時間和基準可能不同；資料不足 252 日時不計算全年漲跌幅。</div>
    <details class="panel watch-rules"><summary>階段怎麼判斷？</summary><p>第一版參數：前 60 日低點、近 20 日未破低、前 40 日整理振幅 ≤15%。確認整理後固定區間，避免支撐隨下跌移動。</p><p>下跌中：今日最低價跌破前 60 日低點。築底觀察：停止創低並符合整理區間。突破待確認：收盤突破固定區間上緣。回測確認：突破後 10 個交易日內，低點回到上緣 +3% 以下，收盤守住上緣 −3%。型態失效：收盤跌破固定底部支撐，或突破後跌破上緣 −3%。</p><p>回測必須發生在突破日之後；失效後重新尋找型態。不符合以上規則時顯示「尚未形成」。至少需 80 個交易日；超過 7 天未更新則暫停判定。</p><p>還原日線與最近成交價的基準可能不同。這是價格型態觀察，參數尚未回測，不包含財報、產業與大盤判斷，也不保證不再下跌。</p></details>`;
    root.querySelector("#watch-add-open").onclick = openAdd;
    root.querySelector("#watch-refresh").onclick = () => load(true);
    root.querySelectorAll("[data-watch-remove]").forEach(
      (button) =>
        (button.onclick = async () => {
          button.disabled = true;
          try {
            await api("watchlist", {
              remove: true,
              id: button.dataset.watchRemove,
            });
            await api("state").then(onState);
            await load();
            toast("已移除追蹤");
          } catch (e) {
            toast(e.message);
            button.disabled = false;
          }
        }),
    );
  }
  function openAdd() {
    const modal = document.querySelector("#modal");
    const content = document.querySelector("#modal-content");
    delete modal.dataset.detailAccount;
    content.innerHTML = `<div class="modal-head"><h2 id="watch-add-title">新增追蹤股票</h2><button class="modal-close" data-close aria-label="關閉">×</button></div><form class="modal-body" id="watch-add"><p class="form-note">選擇市場並輸入代號，加入時會自動取得股票名稱。</p><div class="form-grid"><label class="field">市場<select name="market"><option value="TWSE">台股上市</option><option value="TPEX">台股上櫃</option></select></label><label class="field">股票代號<input name="symbol" placeholder="例如 2330" required maxlength="7" pattern="[0-9]{4,6}[A-Za-z]?" autofocus /></label></div><div class="form-error" role="alert"></div><div class="modal-actions"><button class="button" type="button" data-close>取消</button><button class="button primary" type="submit">加入追蹤</button></div></form>`;
    const form = content.querySelector("#watch-add");
    let submitting = false;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (submitting) return;
      submitting = true;
      const button = form.querySelector('[type="submit"]');
      const error = form.querySelector(".form-error");
      button.disabled = true;
      button.textContent = "正在取得股票名稱…";
      error.textContent = "";
      try {
        await api("watchlist", Object.fromEntries(new FormData(form)));
        await api("state").then(onState);
        if (content.querySelector("#watch-add") === form) modal.close();
        if (connected()) {
          toast("已加入追蹤");
          await load();
          void load(true);
        }
      } catch (e) {
        error.textContent = e.message;
      } finally {
        submitting = false;
        button.disabled = false;
        button.textContent = "加入追蹤";
      }
    };
    if (!modal.open) modal.showModal();
  }
  const onState = (s) => {
    if (connected())
      root.dispatchEvent(
        new CustomEvent("watch-state", { detail: s, bubbles: true }),
      );
  };
  async function load(update = false) {
    if (loading) return;
    loading = true;
    render();
    try {
      const result = await api(
        update ? "watchlist-refresh" : "watchlist",
        update ? {} : undefined,
      );
      if (connected()) rows = result.rows;
    } catch (e) {
      if (connected()) toast(e.message);
    } finally {
      loading = false;
      render();
    }
  }
  void load();
  return () => {
    active = false;
  };
}
