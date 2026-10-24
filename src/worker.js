import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import {
  InputError,
  requireThat,
  text,
  money,
  rate,
  date,
  today,
  FX,
  toTwd,
  accountState,
  validateTimeline,
  transferCosts,
} from "./domain.js";
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const uid = () => crypto.randomUUID();
const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const cookie = (request, name) =>
  request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
const isDev = (request, env) =>
  env.DEV_AUTH === "true" &&
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
function secret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(env.SESSION_SECRET);
}
function sessionCookie(request, name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function sign(env, payload, expiry = "12h") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("family-finance")
    .setAudience("family-finance")
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secret(env));
}
async function verify(env, token) {
  return (
    await jwtVerify(token, secret(env), {
      algorithms: ["HS256"],
      issuer: "family-finance",
      audience: "family-finance",
    })
  ).payload;
}
async function user(request, env) {
  if (isDev(request, env))
    return {
      id: "local-development",
      email: "local@mrandmrsjian.com",
      name: "本機開發",
    };
  try {
    const p = await verify(env, cookie(request, "finance_session") || "");
    requireThat(p.sub && p.email && p.type === "session", "登入已過期");
    return { id: p.sub, email: p.email, name: p.name };
  } catch {
    return null;
  }
}
async function initUser(db, u) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name",
      )
      .bind(u.id, u.email, u.name),
    db.prepare("INSERT OR IGNORE INTO revisions(user_id) VALUES(?)").bind(u.id),
  ]);
}
async function data(db, u) {
  const tables = [
    "holders",
    "accounts",
    "events",
    "loans",
    "loan_balances",
    "goals",
    "revisions",
  ];
  const results = await db.batch(
    tables.map((t) =>
      db.prepare(`SELECT * FROM ${t} WHERE user_id=?`).bind(u.id),
    ),
  );
  return Object.fromEntries(tables.map((t, i) => [t, results[i].results]));
}
function own(items, id, label) {
  const v = items.find((v) => v.id === id);
  requireThat(v, `${label}不存在或無權存取`);
  return v;
}
function choice(v, allowed, label) {
  requireThat(allowed.includes(v), `${label}無效`);
  return v;
}
async function mutate(db, u, b, statements) {
  requireThat(
    Number.isSafeInteger(b.version) && b.version >= 0,
    "請重新整理資料後再試",
  );
  const guard = db
    .prepare("INSERT INTO mutations(id,user_id,expected_version) VALUES(?,?,?)")
    .bind(uid(), u.id, b.version);
  await db.batch([guard, ...statements]);
}
function eventStatement(db, u, e) {
  return db
    .prepare(
      "INSERT INTO events(user_id,account_id,date,kind,amount,cost_delta,cost_twd_delta,rate,note,transfer_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      u.id,
      e.account_id,
      e.date,
      e.kind,
      e.amount,
      e.cost_delta || 0,
      e.cost_twd_delta || 0,
      e.rate,
      e.note || "",
      e.transfer_id || null,
    );
}
async function api(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    db = env.DB;
  if (!["GET", "POST"].includes(request.method))
    return json({ error: "不支援的操作" }, 405);
  if (request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin)
      return json({ error: "請從本站送出操作" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "需要 JSON 格式" }, 415);
    if (Number(request.headers.get("Content-Length")) > 65536)
      return json({ error: "資料太大" }, 413);
  }
  if (path === "/api/auth/google" && request.method === "POST") {
    const b = await request.json();
    let p;
    try {
      const challenge = await verify(
        env,
        cookie(request, "finance_nonce") || "",
      );
      p = (
        await jwtVerify(b.credential, keys, {
          algorithms: ["RS256"],
          audience: env.GOOGLE_CLIENT_ID,
          issuer: ["https://accounts.google.com", "accounts.google.com"],
        })
      ).payload;
      requireThat(
        challenge.type === "nonce" && p.nonce === challenge.nonce,
        "登入驗證碼失效，請重新整理",
      );
      requireThat(
        p.email_verified === true &&
          typeof p.email === "string" &&
          p.email.toLowerCase().endsWith("@mrandmrsjian.com") &&
          p.hd === "mrandmrsjian.com" &&
          typeof p.sub === "string",
        "只允許 @mrandmrsjian.com 的 Google Workspace 帳號",
      );
    } catch {
      return json(
        {
          error:
            "Google 驗證失敗，請使用 @mrandmrsjian.com 帳號並重新整理後登入",
        },
        401,
      );
    }
    const u = { id: p.sub, email: p.email, name: p.name || p.email };
    await initUser(db, u);
    const token = await sign(env, {
      sub: u.id,
      email: u.email,
      name: u.name,
      type: "session",
    });
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, "finance_session", token, 43200),
    });
  }
  if (path === "/api/auth/logout" && request.method === "POST")
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(request, "finance_session", "", 0),
    });
  const u = await user(request, env);
  if (!u) return json({ error: "請先登入" }, 401);
  if (isDev(request, env)) await initUser(db, u);
  if (path === "/api/state" && request.method === "GET")
    return json({ user: u, ...(await data(db, u)) });
  if (path === "/api/export" && request.method === "GET") {
    const transfers = await db
      .prepare("SELECT * FROM transfers WHERE user_id=?")
      .bind(u.id)
      .all();
    return json({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      user: u,
      units: {
        money: "hundredths of the account currency",
        fx: "millionths of TWD per currency unit",
      },
      ...(await data(db, u)),
      transfers: transfers.results,
    });
  }
  if (request.method !== "POST") return json({ error: "找不到頁面" }, 404);
  const bodyText = await request.text();
  requireThat(bodyText.length <= 65536, "資料太大");
  let b;
  try {
    b = JSON.parse(bodyText);
  } catch {
    throw new InputError("JSON 格式錯誤");
  }
  requireThat(b && typeof b === "object" && !Array.isArray(b), "資料格式錯誤");
  const d = await data(db, u),
    stmts = [];
  if (path === "/api/holders") {
    stmts.push(
      db
        .prepare("INSERT INTO holders(id,user_id,name) VALUES(?,?,?)")
        .bind(uid(), u.id, text(b.name, "持有人姓名")),
    );
  } else if (path === "/api/accounts") {
    const holder = own(d.holders, b.holderId, "持有人"),
      id = uid(),
      day = date(b.date),
      currency = choice(b.currency, ["TWD", "USD", "JPY"], "幣別");
    const principal = money(b.principal, "投入本金"),
      amount = money(b.value, "帳戶價值"),
      fx = rate(b.rate, currency);
    stmts.push(
      db
        .prepare(
          "INSERT INTO accounts(id,user_id,holder_id,name,type,currency,created_date) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          u.id,
          holder.id,
          text(b.name, "帳戶名稱"),
          choice(b.type, ["股票", "期貨", "美股", "未上市公司"], "帳戶類型"),
          currency,
          day,
        ),
    );
    stmts.push(
      eventStatement(db, u, {
        account_id: id,
        date: day,
        kind: "opening",
        amount,
        cost_delta: principal,
        cost_twd_delta: toTwd(principal, fx),
        rate: fx,
        note: b.note ? text(b.note, "備註", 500) : "",
      }),
    );
  } else if (path === "/api/events") {
    const a = own(d.accounts, b.accountId, "帳戶"),
      kind = choice(b.kind, ["valuation", "deposit", "withdrawal"], "記錄類型"),
      day = date(b.date),
      amount = money(b.amount, "金額", kind !== "valuation"),
      fx = rate(b.rate, a.currency);
    const s = accountState(a, d.events, day);
    let delta = 0,
      twd = 0;
    if (kind === "deposit") {
      delta = amount;
      twd = toTwd(delta, fx);
    }
    if (kind === "withdrawal") {
      const c = transferCosts(s, amount, b.principal);
      delta = -c.local;
      twd = -c.twd;
    }
    const e = {
      id: Number.MAX_SAFE_INTEGER,
      account_id: a.id,
      date: day,
      kind,
      amount: kind === "withdrawal" ? -amount : amount,
      cost_delta: delta,
      cost_twd_delta: twd,
      rate: fx,
      note: b.note ? text(b.note, "備註", 500) : "",
    };
    validateTimeline(a, [...d.events, e]);
    stmts.push(eventStatement(db, u, e));
  } else if (path === "/api/transfers") {
    const from = own(d.accounts, b.fromId, "轉出帳戶"),
      to = own(d.accounts, b.toId, "轉入帳戶");
    requireThat(from.id !== to.id, "請選擇不同的轉出與轉入帳戶");
    const day = date(b.date),
      amount = money(b.amount, "轉出金額", true),
      received =
        from.currency === to.currency
          ? amount
          : money(b.received, "轉入金額", true);
    const fromRate = rate(b.fromRate, from.currency),
      toRate = rate(b.toRate, to.currency),
      s = accountState(from, d.events, day),
      cost = transferCosts(s, amount, b.principal),
      id = uid();
    const targetCost =
      from.currency === to.currency
        ? cost.local
        : money(b.targetPrincipal, "轉入本金");
    requireThat(
      (cost.local === 0) === (targetCost === 0),
      "轉出與轉入本金必須同時為零，或同時大於零",
    );
    const note = b.note ? text(b.note, "備註", 500) : "";
    const out = {
      id: Number.MAX_SAFE_INTEGER - 1,
      account_id: from.id,
      date: day,
      kind: "transfer_out",
      amount: -amount,
      cost_delta: -cost.local,
      cost_twd_delta: -cost.twd,
      rate: fromRate,
      transfer_id: id,
      note,
    };
    const into = {
      id: Number.MAX_SAFE_INTEGER,
      account_id: to.id,
      date: day,
      kind: "transfer_in",
      amount: received,
      cost_delta: targetCost,
      cost_twd_delta: cost.twd,
      rate: toRate,
      transfer_id: id,
      note,
    };
    validateTimeline(from, [...d.events, out]);
    validateTimeline(to, [...d.events, into]);
    stmts.push(
      db
        .prepare(
          "INSERT INTO transfers(id,user_id,date,request_key) VALUES(?,?,?,?)",
        )
        .bind(id, u.id, day, text(b.requestKey, "操作識別碼")),
      eventStatement(db, u, out),
      eventStatement(db, u, into),
    );
  } else if (path === "/api/loans") {
    const h = own(d.holders, b.holderId, "持有人"),
      id = uid(),
      currency = choice(b.currency, ["TWD", "USD", "JPY"], "幣別"),
      annual = Number(b.annualRate);
    requireThat(
      b.annualRate !== "" &&
        Number.isFinite(annual) &&
        annual >= 0 &&
        annual <= 100,
      "年利率必須介於 0 與 100%",
    );
    stmts.push(
      db
        .prepare(
          "INSERT INTO loans(id,user_id,holder_id,name,currency,annual_rate) VALUES(?,?,?,?,?,?)",
        )
        .bind(id, u.id, h.id, text(b.name, "貸款名稱"), currency, annual),
    );
    stmts.push(
      db
        .prepare(
          "INSERT INTO loan_balances(user_id,loan_id,date,balance,rate,note) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          u.id,
          id,
          date(b.date),
          money(b.balance, "剩餘本金"),
          rate(b.rate, currency),
          "",
        ),
    );
  } else if (path === "/api/loan-balances") {
    const l = own(d.loans, b.loanId, "貸款");
    stmts.push(
      db
        .prepare(
          "INSERT INTO loan_balances(user_id,loan_id,date,balance,rate,note) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          u.id,
          l.id,
          date(b.date),
          money(b.balance, "剩餘本金"),
          rate(b.rate, l.currency),
          b.note ? text(b.note, "備註", 500) : "",
        ),
    );
  } else if (path === "/api/goals") {
    own(d.holders, b.holderId, "持有人");
    stmts.push(
      db
        .prepare(
          "INSERT INTO goals(id,user_id,holder_id,name,target,date,basis) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          uid(),
          u.id,
          b.holderId,
          text(b.name, "目標名稱"),
          money(b.target, "目標金額", true),
          date(b.date, true),
          choice(b.basis, ["assets", "net"], "目標基準"),
        ),
    );
  } else if (path === "/api/delete") {
    const table = choice(
      b.table,
      ["goals", "events", "loan_balances"],
      "記錄類型",
    );
    const row = own(d[table], b.id, "記錄");
    if (table === "events") {
      requireThat(
        !["opening", "transfer_in", "transfer_out"].includes(row.kind),
        "開戶與移轉記錄不可單獨刪除",
      );
      validateTimeline(
        own(d.accounts, row.account_id, "帳戶"),
        d.events.filter((e) => e.id !== row.id),
      );
    }
    if (table === "loan_balances")
      requireThat(
        d.loan_balances.filter((r) => r.loan_id === row.loan_id).length > 1,
        "請保留至少一筆貸款餘額",
      );
    stmts.push(
      db
        .prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`)
        .bind(b.id, u.id),
    );
  } else return json({ error: "找不到操作" }, 404);
  await mutate(db, u, b, stmts);
  return json({ ok: true });
}
export default {
  async fetch(request, env) {
    let response;
    try {
      if (
        new URL(request.url).pathname === "/api/config" &&
        request.method === "GET"
      ) {
        const nonce = uid(),
          token = await sign(env, { nonce, type: "nonce" }, "10m");
        response = json(
          {
            googleClientId: env.GOOGLE_CLIENT_ID,
            domain: "mrandmrsjian.com",
            dev: isDev(request, env),
            nonce,
          },
          200,
          { "Set-Cookie": sessionCookie(request, "finance_nonce", token, 600) },
        );
      } else
        response = new URL(request.url).pathname.startsWith("/api/")
          ? await api(request, env)
          : await env.ASSETS.fetch(request);
    } catch (e) {
      if (
        String(e.message).includes("STALE_VERSION") ||
        String(e.message).includes("transfers.user_id, transfers.request_key")
      )
        response = json(
          { error: "資料已更新或此移轉已完成，請重新整理後確認" },
          409,
        );
      else if (e instanceof InputError)
        response = json({ error: e.message }, 400);
      else {
        console.error(e.message);
        response = json(
          { error: "服務暫時無法完成操作，請檢查伺服器設定" },
          500,
        );
      }
    }
    const h = new Headers(response.headers);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "same-origin");
    h.set("X-Frame-Options", "DENY");
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    return new Response(response.body, { status: response.status, headers: h });
  },
};
