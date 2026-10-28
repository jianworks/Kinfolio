# 家計 Kinfolio

繁體中文家庭財務網站，使用 Cloudflare Workers Static Assets + D1。所有網站檔案均在本目錄。原始 Excel 僅作需求參考，沒有匯入或變更。

## 本機使用

需要 Node.js 22 以上。

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

開啟 http://127.0.0.1:8787 。`DEV_AUTH=true` 只在 localhost / 127.0.0.1 / ::1 主機名稱有效，使用本機 D1，不接觸正式資料。開啟後按「以測試成員進入」，不需要 Google 憑證或隨機密鑰。請勿覆蓋既有 `.dev.vars`。

`preview_database_id` 固定本機資料庫識別，避免填入正式 database_id 後切換到另一份本機資料。

空白本機資料庫可點「建立示範資料」。示範數值為虛構資料，持有人姓名有「示範」前綴，與 Excel 無關。本機資料位於忽略版本控制的 `.wrangler/`。

## 功能與計算規則

- 一個 Google 登入者可以建立多個資產持有人，例如自己、伴侶、家庭成員。每個投資帳戶、貸款、目標都指定持有人。
- 登入者之間的資料完全隔離；目前沒有夫妻共用或委派存取。持有人名稱不是登入帳號。若需要兩人登入看到同一份家庭資料，需增設家庭與成員權限。
- 資產總覽選擇「全部持有人」時，只分別呈現每人的資產、本金、損益、貸款及目標，不合計跨持有人的資產或報酬率。卡片可直接進入個人的完整總覽，檢視日期同樣適用各人資料。
- 投資類型：股票、期貨、美股、未上市公司；幣別：TWD、USD、JPY。
- 開戶輸入起始投入本金、帳戶價值與匯率；初始台幣成本為本金乘當日匯率。需要指定不同的歷史成本時，應逐筆建立歷史投入，再記錄當日估值。
- 估值記錄「當日完整帳戶價值」及當日匯率，不更動本金。一般帳戶及歷史報表沿用檢視日期之前最近的匯率與價值；今日的現金＋持股帳戶可顯示最新可用收盤行情估算。一般手動估值的匯率仍自行輸入；美股現金＋持股模式會同步取得美元兌台幣參考匯率。
- 投入同時增加價值與本金；提領減少價值，可指定提領本金（包含 0），台幣成本按提領本金占剩餘本金的比例扣除。
- 移轉兩端價值及本金以 D1 batch 原子寫入，同時成功或同時失敗。轉出本金扣除實際轉出金額，轉入本金增加實際收到的金額，不需另外填本金。跨幣別兩端以「轉出金額 × 轉出匯率」同額增減台幣本金，整體投入不變。帳戶本金可為負數，表示累計移出超過投入，不代表負債；帳戶價值為零時仍納入本金及損益。這不是券商稅務成本計算。
- 新規則只適用更新後建立的移轉；既有移轉的本金異動與台幣成本保持原樣，不回溯重算或變更歷史資料。
- 移轉不增加家庭總投入台幣成本。實收金額、手續費或不同匯率可能改變台幣資產價值；目前沒有獨立費用欄位。
- 金額最多兩位小數，以最小單位整數儲存，匯率最多六位小數，定義為 1 原幣 = X 台幣。匯兌使用 BigInt 中間運算，再四捨五入至台幣分。
- 損益 = 台幣價值 − 累計台幣本金，包含匯率變化。單一帳戶原幣或台幣本金非正數時，百分比顯示「—（本金非正數）」，仍顯示損益金額。持有人先加總所有帳戶台幣本金與損益，再於加總本金大於零時計算簡單報酬率，不平均各帳戶的百分比；非 IRR 或年化報酬。
- 歷史記錄按日期、再按建立順序重算。同日估值會覆蓋同日之前的帳戶價值，應以當日操作完成後的完整價值估值。補登會檢查後續紀錄，拒絕任何造成帳戶價值為負值的異動，但允許本金為負數。
- 貸款用完整剩餘本金快照追蹤，不輸入或顯示年利率，也不自動計息、計算攤還或拆分本息。
- 目標可按持有人設定總資產或淨資產（資產扣貸款），固定使用台幣。檢視日期可回到過去追蹤當時進度。
- 可刪除一般估值、投入、提領、貸款餘額及目標後重建更正；開戶與移轉不可單筆刪除，以避免資金軌跡不完整。目前沒有修改帳戶、變更歸屬、移轉沖銷或刪除持有人的介面。
- JSON 備份包含目前登入者完整資料，可供封存；尚未實作備份匯入。正式 D1 建議另使用 Cloudflare 的備份／Time Travel。

## 現金＋持股估值

從「投資帳戶 → 明細 → 設定現金＋持股」啟用。支援台幣「股票」帳戶的上市／上櫃股票、ETF，以及美元「美股」帳戶。其他帳戶仍以手動總值記錄。

- 輸入現金及股票市場／代號／股數；每筆持股以一列呈現。資料日期自動記錄為今天，美股估算匯率自動更新，既有設定作為來源不可用時的備用。股數以股為單位，支援小數股；每個帳戶最多 100 檔。股數與單價最多六位小數，使用整數及 BigInt 計算，每筆持股市值四捨五入至原幣分，再與現金加總。
- 台股優先使用富果 MarketData REST `intraday/quote/{symbol}`，以 `X-API-KEY` 驗證。依回應的 `isClose` 使用收盤價或最近實際成交價，不使用試撮價格；核對股票代號與上市／上櫃市場。富果逾時、權限／額度受限或回傳無效資料時，改用證交所／櫃買中心日收盤行情；上櫃來源失敗再用證交所基本市況備援。畫面會標示實際來源與備援。美股使用 Finnhub `quote` 最近成交行情，以美東時間判定價格日期。這不是即時報價。台股與美股行情皆快取 15 分鐘；每次查看會使用快取或更新，較多持股會分批取得。
- 顯示每檔價格日期、來源與估算時間。超過四個日曆日的價格會提示較舊。更新失敗時保留最近價格並警告；完全缺價時總值留空，總覽暫用已儲存估值，不把缺價股票當作零。持股編輯介面不再輸入手動價格，儲存設定後統一使用自動行情；既有歷史快照維持原樣。
- 今日總覽使用完整的目前估算，但查看或修改持股不會自動新增歷史、不變更投入本金。按「儲存今日估值快照」才記錄完整估值；歷史曲線只使用已儲存資料。快照保存當時現金、股數、價格、匯率及來源，之後行情或持股變動不會重寫。估算憑證有效 15 分鐘，其他資料變動後須更新再儲存。
- 最近一次完整持股估算會另存於 D1 `portfolio_current`，保存金額、持股組成與更新時間。開啟／重新登入先顯示這份估算；15 分鐘內切換頁面不重新計算，過期時在背景更新，分批取得或失敗時保留前一份完整金額。畫面標示最後更新時間；此快取不屬於歷史估值快照。修改現金、股數或匯率後，舊組成的估算不會混用；儲存歷史快照時仍重新確認估算與資料版本。
- 買賣、配息與拆股後需自行同步更新現金及股數；目前沒有券商串接或逐筆買賣記帳。現金不可為負數，股數須為正數，已賣出持股請移除。
- 投入、提領和資金移轉會同步調整持股模式的現金。轉出／提領前，若帳本總值落後於目前持股，先儲存估值快照。補登資金異動也會調整目前現金，請避免又把同一筆資金重複計入手動現金。持股模式下投入／提領以反向資金異動更正，不能直接刪除。
- JSON 備份格式升為版本 2，包含設定、持股和已儲存快照，不含行情 API 密鑰。沒有備份匯入介面。

台股主要行情需要富果 API key，美股需要 Finnhub API key，設為 Cloudflare 加密 Secret：

```powershell
npx wrangler secret put FUGLE_API_KEY
npx wrangler secret put FINNHUB_API_KEY
```

在互動提示中貼入密鑰。若本機也要自動美股行情，可在不納入 Git 的 `.dev.vars` 設同名變數。未設定時美股估算可能不完整，仍可用一般「記錄估值」輸入帳戶總值。系統預設所有使用者共用每分鐘 50 次美股更新預算，另以 10 分鐘失敗退避避免持續耗用；供應商本身的額度與行情權限仍以實際方案為準。可透過 `FINNHUB_PER_MINUTE_LIMIT` 配合方案調整內部預算。舊 Alpha Vantage 密鑰與每日預算不再使用；已儲存的歷史快照維持原始來源。

升級既有環境需先執行 `npm run db:local`／`npm run db:remote` 套用遷移，再部署。`0003_portfolios.sql` 新增持股估值結構及事件關聯；`0004_current_estimates.sql` 新增目前估算快取，並從先前完整估算初始化（使用時再核對持股組成）。這些遷移不回寫既有本金或歷史估值。

行情文件：[富果 MarketData SDK](https://github.com/fugle-dev/fugle-marketdata-node/blob/master/README.md)、[證交所 OpenAPI](https://openapi.twse.com.tw/)、[櫃買中心 OpenAPI](https://www.tpex.org.tw/openapi/)、[Finnhub Quote](https://finnhub.io/docs/api/quote)。

## Google 登入

正式環境採與 ezAcquire 相同的 Google Authorization Code Flow + PKCE，登入狀態存於 D1。

1. 在 Google Cloud Console 建立 OAuth 2.0 **Web application** 用戶端，設定 consent screen。
2. 在 **Authorized redirect URIs** 加入完整回呼網址：
   `https://kinfolio.mrandmrsjian.com/auth/google/callback`
3. 將 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 設為 Cloudflare Secrets，並設定 `APP_URL=https://kinfolio.mrandmrsjian.com`。Client Secret 只儲存在 Cloudflare Secrets。
4. 後端檢查 OAuth state、一次性請求、PKCE、Google JWT 簽章、issuer、audience、效期及 nonce，再要求 `email_verified=true`、信箱後綴 **@mrandmrsjian.com**、`hd=mrandmrsjian.com`。
5. 此流程不載入 Google 前端 SDK，不需要設定 Authorized JavaScript origins。只做本機預覽不必在 Google Console 增加 localhost。
6. 若要本機測試真正 Google 登入，另加入 `http://localhost:8787/auth/google/callback`，在 `.dev.vars` 設定 `DEV_AUTH=false`、`APP_URL=http://localhost:8787` 及 Google 用戶端憑證。

Cookie 只保存安全隨機憑證，D1 只保存其 SHA-256 雜湊，8 小時到期。Cookie 使用 HttpOnly、SameSite=Lax，HTTPS 下採 Secure 與 `__Host-` 前綴。登出立即刪除 D1 工作階段，舊 Cookie 即使被保留也無法再次使用。OAuth state 同樣只存雜湊，10 分鐘內有效，回呼取出時即刪除，不能重用。

本機免驗證必須同時具備 `DEV_AUTH=true` 和 loopback hostname；正式網域不接受免驗證模式。測試成員沿用 `local-development` ID，因此既有本機資料的歸屬保持不變。

先前 JWT Cookie 與 `SESSION_SECRET` 已停用，升級後需重新登入；原有帳戶及財務資料不變。舊的 SESSION_SECRET 可從 Cloudflare 移除，也可暫留，它不再被程式讀取。新增 `0002_auth_sessions.sql` 只建立登入相關資料表。

## 部署到自己的 Cloudflare

```powershell
npx wrangler login
npx wrangler d1 create finance-db
```

將回傳的 `database_id` 填入 `wrangler.jsonc`，取代全零佔位值。Worker 名稱可自行修改。

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# 互動貼上 Google OAuth Client Secret，請勿貼進程式碼或 Git
npm run db:remote
npm run check
npm test
npm run build
npm run deploy
```

部署設定使用 `keep_vars=true`，保留 Cloudflare 上的變數；Google 憑證不放入 wrangler.jsonc，避免覆寫已設定的 Secrets。

不要在 Cloudflare 設定 DEV_AUTH。密鑰不要寫入 wrangler.jsonc 或提交版本控制。部署正式環境不會上傳 `.dev.vars`、Excel 或本機資料庫。資料庫初始為空；建立自己的持有人與帳戶後即可使用。

此專案直接部署至自己的 Cloudflare，未使用代管 Sites 註冊或發布。

## 驗證

```powershell
npm run check
npm test
npm run test:integration
npm run build
```

整合測試會在 8791 埠啟動獨立 Worker，建立隔離的本機 D1，測試驗證／來源檢查、不同登入者隔離、移轉原子性、跨幣別成本、重送／並行寫入、補登、貸款、目標和匯出；結束時停止測試服務，測試資料保留在 `.wrangler/test-*` 供檢查，不修改預覽資料。

Google 真實登入仍須設定自己的 Google Client ID、Client Secret 及正確回呼網址後驗證。

## 架構

`public/` 為免前端建置的 HTML/CSS/ES modules；`public/domain.js` 是前後端共用金額規則。`src/worker.js` 提供驗證及 D1 API；`migrations/` 是初始資料庫；`tests/` 是規則與實際 Worker/D1 測試。所有 API 禁用快取，沒有第三方追蹤或外部字型。

參考文件：[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[Google ID token 驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。

## 現金規劃

獨立的台幣月度估算，從主選單「現金規劃」進入。設定起始月份、第一個月開始前的期初現金、安全底線，再新增未來 12 個月的收入與支出。首月金額可套用全年，再調整個別月份。空白月份自動按 0 計算，儲存時補為 0；表格的零金額留白顯示。

保留額取規劃期間最大的累計現金缺口加安全底線，向上取整至萬元。顯示可調度／待補足金額、首次低於底線的月份、現金走勢與月表。每個登入者保存一份規劃，可跨分頁切換後繼續編輯；按「儲存規劃」才寫入資料庫。所有金額固定台幣，不連結資產、貸款或銀行帳戶，不估算月內入扣款先後。

升級需套用 `0005_cash_plans.sql`（本機 `npm run db:local`），備份版本升為 3 並包含規劃。現有版本 2 的持股資料語意不變。

現金規劃每月依台北日期滾動：保留重疊月份的金額，已過月份複製到次年同月份；不把舊金額直接重新標成下一個月。開啟頁面或保持頁面開啟跨月時自動更新，按儲存後保存。可手動向後移動期間，不能倒退月份。期初現金保留原值並標記其基準月份，換月後提示重新確認。

### 持股估算的自動匯率

美股現金＋持股帳戶在更新行情時，同步查詢 ExchangeRate-API 的 USD／TWD 每日參考匯率，並使用於台幣總值；畫面與新快照保存匯率日期、來源與警告。來源每日更新，伺服器共用快取一小時，不代表銀行即時買賣價。失敗時沿用來源最近匯率；首次取不到則使用目前估算／帳戶原有匯率，明確標示資料日期未知與警告，不當作即時匯率。歷史投入本金、交易匯率與已儲存快照不重算。手動估值模式仍由使用者記錄匯率。

匯率資料來源與使用說明：[ExchangeRate-API](https://www.exchangerate-api.com/docs/free)。


### 個人主題配色

側欄「主題配色」提供 8 組配色：家計森林（原有綠色）、珊瑚海岸、花園派對、創意工坊、日落沙丘、薄荷糖果、北歐拼色、極光夜色（深色）。點選立即套用，可隨時切回「家計森林」。手機版同樣可使用。

設定依登入帳號記在目前瀏覽器，重新登入後恢復，並同步至同一瀏覽器的其他分頁；不跨裝置同步。瀏覽器無法儲存時會顯示提示，仍可立即預覽。配色只調整外觀，收支與損益的綠／紅色意義維持一致。
