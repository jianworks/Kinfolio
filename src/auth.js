import { createRemoteJWKSet, jwtVerify } from "jose";
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const now = () => Math.floor(Date.now() / 1000);
const random = () => crypto.randomUUID() + crypto.randomUUID();
const DOMAIN = "mrandmrsjian.com";
export const isDev = (request, env) =>
  env.DEV_AUTH === "true" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
export async function hash(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
const cookieName = (request, kind) =>
  (new URL(request.url).protocol === "https:" ? "__Host-" : "") +
  "kinfolio_" +
  kind;
function readCookie(request, kind) {
  const name = cookieName(request, kind);
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
}
const cookie = (request, kind, value, age) =>
  `${cookieName(request, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
function redirect(location, cookies = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}
export async function initUser(db, u) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name",
      )
      .bind(u.id, u.email, u.name),
    db.prepare("INSERT OR IGNORE INTO revisions(user_id) VALUES(?)").bind(u.id),
  ]);
}
export async function currentUser(request, env) {
  if (isDev(request, env)) {
    const u = {
      id: "local-development",
      email: "local@mrandmrsjian.com",
      name: "本機開發",
    };
    await initUser(env.DB, u);
    return u;
  }
  const token = readCookie(request, "session");
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?",
  )
    .bind(await hash(token), now())
    .first();
}
export function claimsUser(p, nonce) {
  if (
    typeof nonce !== "string" ||
    !nonce ||
    p.nonce !== nonce ||
    p.email_verified !== true ||
    p.hd !== DOMAIN ||
    typeof p.email !== "string" ||
    !p.email.toLowerCase().endsWith("@" + DOMAIN) ||
    typeof p.sub !== "string" ||
    !p.sub
  )
    throw new Error("domain");
  return {
    id: p.sub,
    email: p.email.toLowerCase(),
    name: typeof p.name === "string" ? p.name : p.email,
  };
}
const verifyIdToken = async (token, audience) =>
  (
    await jwtVerify(token, googleKeys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    })
  ).payload;
async function exchangeCode(parameters) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("exchange");
  const tokens = await r.json();
  if (typeof tokens.id_token !== "string") throw new Error("exchange");
  return tokens.id_token;
}
// Dependencies are injectable for offline protocol tests; production uses Google's endpoints.
export function createAuth(deps = { verifyIdToken, exchangeCode }) {
  return async function authRoute(request, env) {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/api/config" && request.method === "GET")
      return Response.json(
        {
          dev: isDev(request, env),
          googleConfigured: !!(
            env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ),
          domain: DOMAIN,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (path === "/api/auth/logout" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin)
        return Response.json({ error: "請從本站送出操作" }, { status: 403 });
      const token = readCookie(request, "session");
      if (token)
        await env.DB.prepare("DELETE FROM sessions WHERE id=?")
          .bind(await hash(token))
          .run();
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": cookie(request, "session", "", 0),
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (
      !["/auth/google", "/auth/google/callback"].includes(path) ||
      request.method !== "GET"
    )
      return Response.json({ error: "找不到操作" }, { status: 404 });
    const origin = env.APP_URL || "https://kinfolio.mrandmrsjian.com";
    if (url.origin !== origin)
      return new Response("登入網址不符，請使用 " + origin, { status: 400 });
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
      return redirect("/?auth_error=config");
    const callback = origin + "/auth/google/callback";
    if (path === "/auth/google") {
      const state = random(),
        nonce = random(),
        verifier = random();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM oauth_requests WHERE expires_at<?").bind(
          now(),
        ),
        env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now()),
        env.DB.prepare(
          "INSERT INTO oauth_requests(id,nonce,verifier,expires_at) VALUES(?,?,?,?)",
        ).bind(await hash(state), nonce, verifier, now() + 600),
      ]);
      const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      target.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: callback,
        response_type: "code",
        scope: "openid email profile",
        hd: DOMAIN,
        state,
        nonce,
        code_challenge: await hash(verifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return redirect(target.href, [cookie(request, "oauth", state, 600)]);
    }
    const clear = cookie(request, "oauth", "", 0),
      state = url.searchParams.get("state");
    if (!state || state !== readCookie(request, "oauth"))
      return redirect("/?auth_error=state", [clear]);
    const pending = await env.DB.prepare(
      "DELETE FROM oauth_requests WHERE id=? RETURNING nonce,verifier,expires_at",
    )
      .bind(await hash(state))
      .first();
    if (!pending || pending.expires_at <= now())
      return redirect("/?auth_error=state", [clear]);
    if (url.searchParams.has("error") || !url.searchParams.get("code"))
      return redirect("/?auth_error=cancelled", [clear]);
    let u;
    try {
      const token = await deps.exchangeCode({
        code: url.searchParams.get("code"),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callback,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      });
      u = claimsUser(
        await deps.verifyIdToken(token, env.GOOGLE_CLIENT_ID),
        pending.nonce,
      );
    } catch (e) {
      return redirect(
        "/?auth_error=" + (e.message === "domain" ? "domain" : "failed"),
        [clear],
      );
    }
    // Let D1 failures reach the service error handler, rather than disguising them as Google errors.
    await initUser(env.DB, u);
    const token = random();
    await env.DB.prepare(
      "INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)",
    )
      .bind(await hash(token), u.id, now() + 28800)
      .run();
    return redirect("/", [clear, cookie(request, "session", token, 28800)]);
  };
}
export const authRoute = createAuth();
