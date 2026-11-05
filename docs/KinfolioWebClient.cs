using System;
using System.Globalization;
using System.Net;
using System.Text;

public static class KinfolioWebClient
{
    private sealed class TimeoutWebClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = 10000;
            return request;
        }
    }

    // 同步呼叫，最多等待約 10 秒；請放在取得權益數之後執行。
    // int / long 都能直接傳入 decimal 參數，不需要加 m。
    public static string PushEquity(
        decimal equity, DateTime tradingDate, DateTimeOffset observedAt)
    {
        string key = Environment.GetEnvironmentVariable("KINFOLIO_SYNC_KEY");
        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("尚未設定 KINFOLIO_SYNC_KEY");

        // 只拼接固定格式的數字與日期，不接受任意字串內容。
        string json = "{\"equity\":\""
            + equity.ToString(CultureInfo.InvariantCulture)
            + "\",\"currency\":\"TWD\",\"dataDate\":\""
            + tradingDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            + "\",\"observedAt\":\""
            + observedAt.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture)
            + "\"}";

        using (var client = new TimeoutWebClient())
        {
            client.Encoding = Encoding.UTF8;
            client.Headers[HttpRequestHeader.ContentType] = "application/json; charset=utf-8";
            client.Headers[HttpRequestHeader.Authorization] = "Bearer " + key;
            return client.UploadString(
                "https://kinfolio.mrandmrsjian.com/api/integrations/futures-equity",
                "POST", json);
        }
    }
}
