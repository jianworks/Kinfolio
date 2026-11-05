# 期貨最新權益數同步

交易程式以 HTTPS POST 推送最新完整權益數；不需 Google 登入。同步不新增歷史估值、不變更本金。使用者登入後，在期貨帳戶明細按「儲存今日估值快照」才新增歷史；曲線繼續只使用已儲存記錄。首次同步後，重新整理網站可看到最新數值；明細也提供「重新讀取」。目前不做網頁即時推播。

預設只接受帳戶 `e3640959-decc-46f1-81d4-3b33438eedc6`。金鑰不能選擇其他帳戶、讀取資產或寫入歷史；帳戶必須已存在且類型為期貨。獨立環境可以用 `FUTURES_SYNC_ACCOUNT_ID` 指定該環境的帳戶，不由請求端選擇。未設定金鑰時 API 回覆 503。

## 啟用

在 Kinfolio 目錄依序執行：

```powershell
npm run db:remote
npx wrangler secret put FUTURES_SYNC_KEY
npm run deploy
```

在密鑰提示中貼上至少 32 字元的密碼學隨機金鑰，並將同一值設為交易程式環境變數 `KINFOLIO_SYNC_KEY`。不要提交到 Git、放在網址或印到日誌。替換 Cloudflare Secret 即可撤銷舊金鑰；刪除 Secret 可停用同步。產生金鑰可使用密碼管理器的隨機密碼功能。

本機測試則先 `npm run db:local`，在不提交 Git 的 `.dev.vars` 設 `FUTURES_SYNC_KEY`、`FUTURES_SYNC_ACCOUNT_ID`（本機測試期貨帳戶）。本機與正式資料分開。

## API

`POST https://kinfolio.mrandmrsjian.com/api/integrations/futures-equity`

標頭：`Authorization: Bearer <金鑰>`、`Content-Type: application/json`。

```json
{
  "equity": "1234567.89",
  "currency": "TWD",
  "dataDate": "2026-11-04",
  "observedAt": "2026-11-04T13:50:00+08:00"
}
```

- `equity`：完整帳戶權益數，以元為單位，最多兩位小數。沿用現有帳本規則，只接受非負數，上限一兆；負權益數回覆 400，不會默默改成零。
- `currency`：須與帳戶相同。台幣帳戶匯率固定為 1。外幣帳戶另傳 `rate`，代表一原幣折合多少台幣，最多六位小數。
- `dataDate`：券商資料所屬交易日，不要直接以執行日期取代。夜盤可傳未來交易日，以涵蓋跨週末／休市的情況；最晚允許台北日期之後 14 天。屬於未來交易日的權益數可顯示，但需等到該交易日才能保存今日快照。
- `observedAt`：實際取得這筆資料的時間，必須包含時區。重試必須使用原來的時間與內容；不要重試時重新產生查詢時間。不可超前伺服器時間超過一分鐘。

成功回覆 `{"ok":true,"status":"updated"}`；相同資料重送回覆 `{"ok":true,"status":"unchanged"}`，不改最後同步時間。查詢時間必須比目前資料新且交易日不能倒退；較舊資料、同一時間不同內容回覆 409，不覆蓋新值。只保存一筆最新權益數，不累積同步歷史。

其他狀態：400 資料錯誤、401 金鑰無效、405 方法錯誤、413 超過 4 KiB、415 非 JSON、503 尚未設定金鑰或帳戶。5xx／連線失敗可重試同一份資料；400／401／409 應記錄並處理，避免無限重試。同步錯誤不應中止原本的交易流程。

## C# WebClient 呼叫範例

使用 `System.Net.WebClient` 的完整版本見 [KinfolioWebClient.cs](KinfolioWebClient.cs)。可將該檔加入既有專案，不需額外套件；使用 `DateTime` 取代 `DateOnly`，整數權益數可直接傳入。這是同步呼叫，設定 10 秒請求逾時。

```csharp
int equity = 1234567; // 改為券商實際回傳的權益數。
DateTime tradingDate = new DateTime(2026, 11, 4); // 使用券商交易日。
DateTimeOffset observedAt = DateTimeOffset.UtcNow; // 取得資料當下記下時間。

try
{
    string result = KinfolioWebClient.PushEquity(equity, tradingDate, observedAt);
    Console.WriteLine(result);
}
catch (System.Net.WebException ex)
{
    // 非 2xx、逾時或網路錯誤；接到既有日誌／告警，不中止交易流程。
    Console.Error.WriteLine(ex.Message);
}
catch (InvalidOperationException ex)
{
    Console.Error.WriteLine(ex.Message); // 未設定金鑰。
}
```

金鑰仍讀取環境變數 `KINFOLIO_SYNC_KEY`。重試沿用原始權益數、交易日及查詢時間；不要在交易關鍵路徑上無限重試。.NET 6 以上可能顯示 `WebClient` 已過時的編譯警告，原有 `HttpClient` 範例仍保留於下方。

## C# HttpClient 呼叫範例（.NET 6 以上，不需額外套件）

```csharp
using System;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;

public static class KinfolioSync
{
    // 重用 HttpClient；金鑰只加到這次請求。
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    public static async Task<string> PushEquityAsync(
        decimal equity,
        DateOnly tradingDate,
        DateTimeOffset observedAt,
        CancellationToken cancellationToken = default)
    {
        var key = Environment.GetEnvironmentVariable("KINFOLIO_SYNC_KEY");
        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("尚未設定 KINFOLIO_SYNC_KEY");

        using var request = new HttpRequestMessage(HttpMethod.Post,
            "https://kinfolio.mrandmrsjian.com/api/integrations/futures-equity");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Content = JsonContent.Create(new
        {
            // 使用 decimal 與固定文化格式，不經過 double 或默默四捨五入。
            equity = equity.ToString(CultureInfo.InvariantCulture),
            currency = "TWD",
            dataDate = tradingDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            observedAt = observedAt.ToString(
                "yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture)
        });

        using var response = await Client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"Kinfolio 同步失敗（{(int)response.StatusCode}）：{body}",
                null, response.StatusCode);

        return body; // updated 或 unchanged 都是成功。
    }
}
```

取得券商權益數時，保存這次查詢的時間，再呼叫：

```csharp
// 用券商實際回傳的權益數及交易日代入，不要固定使用下列示範值。
decimal equity = 1234567.89m;
DateOnly tradingDate = new(2026, 11, 4);
DateTimeOffset observedAt = DateTimeOffset.UtcNow;

try
{
    string result = await KinfolioSync.PushEquityAsync(
        equity, tradingDate, observedAt);
    Console.WriteLine(result);
}
catch (Exception ex) when (
    ex is HttpRequestException || ex is OperationCanceledException ||
    ex is InvalidOperationException)
{
    // 接到既有日誌／告警；同步失敗不要中止交易流程。
    Console.Error.WriteLine(ex.Message);
}
```

重試時沿用原本的 `equity`、`tradingDate` 與 `observedAt`。請勿在重試迴圈內重新指定 `observedAt`。

上傳重試及失敗告警由既有交易程式安排。入金、出金仍須另外記錄本金異動；同步權益數不會自動辨識資金流。

手動快照以按下儲存當日的台北日期記帳，並保留來源交易日、查詢時間、同步時間與權益數。舊資料會提示日期；同一筆來源同日不可重複保存。若權益數在儲存期間變動，會拒絕操作，重新讀取後再儲存。刪除快照不影響最新權益數。
