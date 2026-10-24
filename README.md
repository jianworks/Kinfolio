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
- 投資類型：股票、期貨、美股、未上市公司；幣別：TWD、USD、JPY。
- 開戶輸入起始投入本金、帳戶價值與匯率；初始台幣成本為本金乘當日匯率。需要指定不同的歷史成本時，應逐筆建立歷史投入，再記錄當日估值。
- 估值記錄「當日完整帳戶價值」及當日匯率，不更動本金。報表各帳戶沿用檢視日期之前最近的匯率與價值，並顯示記錄日期，沒有即時行情或自動匯率。
- 投入同時增加價值與本金；提領減少價值，可指定提領本金（包含 0），台幣成本按提領本金占剩餘本金的比例扣除。
- 移轉兩端價值及本金以 D1 batch 原子寫入，同時成功或同時失敗。同幣別兩端金額／本金相同；跨幣別輸入實際轉入金額及對應轉入本金，歷史台幣成本由來源攜帶至目的地，不以現行匯率重設。移轉本金預設為轉出金額，以來源剩餘本金為上限；可自行指定。這不是券商稅務成本計算。
- 移轉不增加家庭總投入台幣成本。實收金額、手續費或不同匯率可能改變台幣資產價值；目前沒有獨立費用欄位。
- 金額最多兩位小數，以最小單位整數儲存，匯率最多六位小數，定義為 1 原幣 = X 台幣。匯兌使用 BigInt 中間運算，再四捨五入至台幣分。
- 損益 = 台幣價值 − 歷史台幣本金，包含匯率變化；簡單報酬率 = 損益 / 本金，非 IRR 或年化報酬。
- 歷史記錄按日期、再按建立順序重算。同日估值會覆蓋同日之前的帳戶價值，應以當日操作完成後的完整價值估值。補登會檢查後續紀錄，拒絕任何造成負值的異動。
- 貸款用完整剩餘本金快照追蹤，年利率供參考，不自動計息、計算攤還或拆分本息。
- 目標可按持有人設定總資產或淨資產（資產扣貸款），固定使用台幣。檢視日期可回到過去追蹤當時進度。
- 可刪除一般估值、投入、提領、貸款餘額及目標後重建更正；開戶與移轉不可單筆刪除，以避免資金軌跡不完整。目前沒有修改帳戶、變更歸屬、移轉沖銷或刪除持有人的介面。
- JSON 備份包含目前登入者完整資料，可供封存；尚未實作備份匯入。正式 D1 建議另使用 Cloudflare 的備份／Time Travel。

## Google 登入

正式環境採與 ezAcquire 相同的 Google Authorization Code Flow + PKCE，登入狀態存於 D1。

1. 在 Google Cloud Console 建立 OAuth 2.0 **Web application** 用戶端，設定 consent screen。
2. 在 **Authorized redirect URIs** 加入完整回呼網址：
   `https://kinfolio.mrandmrsjian.com/auth/google/callback`
3. 將 Client ID 填入 `wrangler.jsonc` 的 `vars.GOOGLE_CLIENT_ID`，設定 `GOOGLE_CLIENT_SECRET` 與 `APP_URL=https://kinfolio.mrandmrsjian.com`。Client Secret 只儲存在 Cloudflare Secrets。
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
npx wrangler secret put GOOGLE_CLIENT_SECRET
# 互動貼上 Google OAuth Client Secret，請勿貼進程式碼或 Git
npm run db:remote
npm run check
npm test
npm run build
npm run deploy
```

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
