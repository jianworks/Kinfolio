import { hash } from "./auth.js";
import {
  requireThat,
  money,
  rate,
  date,
  today,
  validateTimeline,
} from "./domain.js";

export const FUTURES_ACCOUNT_ID = "e3640959-decc-46f1-81d4-3b33438eedc6";
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// This credential authorizes only this route and one configured account, never browser APIs.
export async function syncFutures(request, env) {
  if (request.method !== "POST") return json({ error: "不支援的操作" }, 405);
  if (!env.FUTURES_SYNC_KEY || env.FUTURES_SYNC_KEY.length < 32)
    return json({ error: "期貨同步尚未啟用" }, 503);
  const supplied = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (
    !supplied ||
    (await hash(supplied)) !== (await hash(env.FUTURES_SYNC_KEY))
  )
    return json({ error: "同步金鑰無效" }, 401);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return json({ error: "需要 JSON 格式" }, 415);
  // Bound the actual stream, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "需要 JSON 格式" }, 400);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      return json({ error: "資料太大" }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let b;
  try {
    b = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "JSON 格式錯誤" }, 400);
  }
  requireThat(b && typeof b === "object" && !Array.isArray(b), "資料格式錯誤");
  requireThat(
    Object.keys(b).every((k) =>
      ["equity", "currency", "dataDate", "observedAt", "rate"].includes(k),
    ),
    "含有不支援的欄位",
  );
  const id = env.FUTURES_SYNC_ACCOUNT_ID || FUTURES_ACCOUNT_ID;
  const a = await env.DB.prepare("SELECT * FROM accounts WHERE id=?")
    .bind(id)
    .first();
  if (!a || a.type !== "期貨") return json({ error: "同步帳戶尚未就緒" }, 503);
  requireThat(b.currency === a.currency, "幣別與帳戶不符");
  requireThat(["string", "number"].includes(typeof b.equity), "權益數格式錯誤");
  const amount = money(b.equity, "權益數"),
    fx = rate(b.rate, a.currency);
  // The producer supplies the trading date; allow upcoming sessions across holidays.
  const day = date(b.dataDate, true);
  const latestDate = new Date(
    Date.parse(today() + "T00:00:00Z") + 14 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  requireThat(day >= a.created_date && day <= latestDate, "交易日超出允許範圍");
  requireThat(
    typeof b.observedAt === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
        b.observedAt,
      ) &&
      Number.isFinite(Date.parse(b.observedAt)),
    "查詢時間須包含時區",
  );
  const observed = new Date(b.observedAt).toISOString(),
    now = new Date().toISOString();
  requireThat(
    Date.parse(observed) <= Date.now() + 60000,
    "查詢時間超出允許範圍",
  );
  const syncId = await hash(JSON.stringify([id, amount, fx, day, observed]));
  const result = await env.DB.prepare(
    `INSERT INTO futures_current(account_id,user_id,sync_id,amount,rate,data_date,observed_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
    sync_id=excluded.sync_id,amount=excluded.amount,rate=excluded.rate,data_date=excluded.data_date,
    observed_at=excluded.observed_at,updated_at=excluded.updated_at
    WHERE excluded.observed_at>futures_current.observed_at AND excluded.data_date>=futures_current.data_date`,
  )
    .bind(id, a.user_id, syncId, amount, fx, day, observed, now)
    .run();
  if (result.meta.changes) return json({ ok: true, status: "updated" });
  const current = await env.DB.prepare(
    "SELECT sync_id FROM futures_current WHERE account_id=?",
  )
    .bind(id)
    .first();
  return current?.sync_id === syncId
    ? json({ ok: true, status: "unchanged" })
    : json({ error: "資料較舊或同一查詢時間的內容不一致，未更新" }, 409);
}

export function futuresSnapshot(db, u, b, d) {
  const a = d.accounts.find((a) => a.id === b.accountId && a.type === "期貨");
  requireThat(a, "帳戶不存在或無權存取");
  const r = d.futures_current.find((r) => r.account_id === a.id);
  requireThat(r && r.sync_id === b.syncId, "權益數已更新，請重新整理後再儲存");
  const day = today();
  requireThat(r.data_date <= day, "交易日尚未到，請於交易日再儲存快照");
  validateTimeline(a, [
    ...d.events,
    {
      id: Number.MAX_SAFE_INTEGER,
      account_id: a.id,
      date: day,
      kind: "valuation",
      amount: r.amount,
      cost_delta: 0,
      cost_twd_delta: 0,
      rate: r.rate,
    },
  ]);
  return db
    .prepare(
      `INSERT INTO events(user_id,account_id,date,kind,amount,rate,note,futures_sync_id,futures_details_json)
    VALUES(?,?,?,'valuation',?,?,?,?,?)`,
    )
    .bind(
      u.id,
      a.id,
      day,
      r.amount,
      r.rate,
      `期貨權益數快照；交易日 ${r.data_date}；查詢時間 ${r.observed_at}`,
      r.sync_id,
      JSON.stringify(r),
    );
}
