import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { hash } from "../src/auth.js";
import { accountState, today } from "../public/domain.js";
const cli = resolve("node_modules/wrangler/bin/wrangler.js"),
  storage = resolve(".wrangler", "test-" + crypto.randomUUID()),
  origin = "http://127.0.0.1:8791";
const testConfig = resolve(storage, "wrangler.json");
mkdirSync(storage, { recursive: true });
writeFileSync(
  testConfig,
  JSON.stringify({
    name: "kinfolio-integration-test",
    main: resolve("src/worker.js"),
    compatibility_date: "2026-10-24",
    assets: {
      directory: resolve("public"),
      binding: "ASSETS",
      run_worker_first: ["/api/*", "/auth/*"],
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "finance-db",
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: resolve("migrations"),
      },
    ],
    vars: {
      DEV_AUTH: "false",
      APP_URL: origin,
      GOOGLE_CLIENT_ID: "test-id",
      GOOGLE_CLIENT_SECRET: "test-placeholder",
    },
  }),
);

const run = (args) =>
  execFileSync(process.execPath, [cli, ...args, "--config", testConfig], {
    stdio: "pipe",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
run([
  "d1",
  "migrations",
  "apply",
  "finance-db",
  "--local",
  "--persist-to",
  storage,
]);
run([
  "d1",
  "execute",
  "finance-db",
  "--local",
  "--persist-to",
  storage,
  "--command",
  "INSERT INTO users VALUES('test-a','a@mrandmrsjian.com','A'),('test-b','b@mrandmrsjian.com','B'); INSERT INTO revisions(user_id) VALUES('test-a'),('test-b');",
]);
const server = spawn(
  process.execPath,
  [
    cli,
    "dev",
    "--config",
    testConfig,
    "--port",
    "8791",
    "--ip",
    "127.0.0.1",
    "--persist-to",
    storage,
    "--var",
    "DEV_AUTH:false",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));
const cookies = {};
for (const sub of ["test-a", "test-b"]) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  run([
    "d1",
    "execute",
    "finance-db",
    "--local",
    "--persist-to",
    storage,
    "--command",
    `INSERT INTO sessions(id,user_id,expires_at) VALUES('${await hash(token)}','${sub}',${Math.floor(Date.now() / 1000) + 3600});`,
  ]);
  cookies[sub] = "kinfolio_session=" + token;
}
async function request(path, body, who = "test-a", custom = {}) {
  const r = await fetch(origin + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookies[who] || "",
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...custom,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function state(who = "test-a") {
  const r = await request("state", null, who);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function post(path, b, who = "test-a", status = 200) {
  const s = await state(who),
    r = await request(path, { ...b, version: s.revisions[0].version }, who);
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r;
}
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(log);
    try {
      if ((await fetch(origin + "/api/config")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, "Test server did not start: " + log);
  const publicConfig = await request("config", null, "anonymous");
  assert.equal(publicConfig.status, 200);
  assert.equal(publicConfig.data.dev, false);
  assert.equal(publicConfig.data.googleConfigured, true);
  const googleStart = await fetch(origin + "/auth/google", {
    redirect: "manual",
  });
  assert.equal(googleStart.status, 302);
  const googleTarget = new URL(googleStart.headers.get("Location"));
  assert.equal(googleTarget.origin, "https://accounts.google.com");
  assert.equal(
    googleTarget.searchParams.get("redirect_uri"),
    origin + "/auth/google/callback",
  );
  const invalidCallback = await fetch(
    origin + "/auth/google/callback?code=invalid",
    { redirect: "manual" },
  );
  assert.equal(invalidCallback.headers.get("Location"), "/?auth_error=state");
  assert.equal((await request("state", null, "anonymous")).status, 401);
  assert.equal(
    (await request("auth/google", { credential: "invalid" })).status,
    404,
  );
  assert.equal(
    (
      await request("holders", { name: "blocked" }, "test-a", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  await post("holders", { name: "Owner A" });
  let s = await state(),
    h = s.holders[0].id;
  const base = {
    holderId: h,
    type: "股票",
    currency: "TWD",
    date: "2020-01-01",
    principal: 1000,
    value: 1500,
    rate: 1,
  };
  await post("accounts", { ...base, name: "A" });
  await post("accounts", { ...base, name: "B", principal: 0, value: 0 });
  s = await state();
  const a = s.accounts.find((a) => a.name === "A"),
    b = s.accounts.find((a) => a.name === "B");
  const transfer = {
    fromId: a.id,
    toId: b.id,
    date: "2020-02-01",
    amount: 200,
    principal: 150,
    fromRate: 1,
    toRate: 1,
    requestKey: crypto.randomUUID(),
  };
  await post("transfers", transfer);
  s = await state();
  assert.equal(accountState(a, s.events).value, 130000);
  assert.equal(accountState(a, s.events).cost, 85000);
  assert.equal(accountState(b, s.events).cost, 15000);
  assert.equal(s.events.filter((e) => e.transfer_id).length, 2);
  await post("transfers", transfer, "test-a", 409);
  const afterDuplicate = await state();
  assert.equal(afterDuplicate.events.length, s.events.length);
  assert.equal(afterDuplicate.revisions[0].version, s.revisions[0].version);
  await post(
    "transfers",
    { ...transfer, amount: 999999, requestKey: crypto.randomUUID() },
    "test-a",
    400,
  );
  await post("accounts", {
    ...base,
    name: "USD",
    currency: "USD",
    principal: 100,
    value: 120,
    rate: 30,
  });
  s = await state();
  const usd = s.accounts.find((a) => a.name === "USD"),
    costBefore = s.accounts
      .map((a) => accountState(a, s.events).costTwd)
      .reduce((a, b) => a + b, 0);
  await post("transfers", {
    fromId: usd.id,
    toId: b.id,
    date: "2020-03-01",
    amount: 10,
    received: 320,
    principal: 8,
    targetPrincipal: 256,
    fromRate: 32,
    toRate: 1,
    requestKey: crypto.randomUUID(),
  });
  s = await state();
  assert.equal(
    s.accounts
      .map((a) => accountState(a, s.events).costTwd)
      .reduce((a, b) => a + b, 0),
    costBefore,
  );
  await post("events", {
    accountId: a.id,
    kind: "valuation",
    date: "2020-04-01",
    amount: 1600,
    rate: 1,
  });
  await post("events", {
    accountId: a.id,
    kind: "deposit",
    date: "2020-04-01",
    amount: 100,
    rate: 1,
  });
  s = await state();
  assert.equal(accountState(a, s.events).value, 170000);
  await post("events", {
    accountId: a.id,
    kind: "withdrawal",
    date: "2020-05-01",
    amount: 1600,
    principal: 0,
    rate: 1,
  });
  await post(
    "events",
    {
      accountId: a.id,
      kind: "withdrawal",
      date: "2020-04-02",
      amount: 200,
      principal: 0,
      rate: 1,
    },
    "test-a",
    400,
  );
  await post("loans", {
    holderId: h,
    name: "Mortgage",
    currency: "USD",
    annualRate: 2.2,
    date: "2020-01-01",
    balance: 10000,
    rate: 30,
  });
  s = await state();
  await post("loan-balances", {
    loanId: s.loans[0].id,
    date: today(),
    balance: 9000,
    rate: 32,
  });
  await post("goals", {
    holderId: h,
    name: "Goal",
    target: 10000000,
    date: "2030-12-31",
    basis: "net",
  });
  assert.equal((await state("test-b")).accounts.length, 0);
  await post(
    "events",
    { accountId: a.id, kind: "valuation", date: today(), amount: 1, rate: 1 },
    "test-b",
    400,
  );
  await post("accounts", { ...base, name: "Forbidden" }, "test-b", 400);
  const before = await state(),
    version = before.revisions[0].version;
  const race = await Promise.all([
    request("holders", { name: "Race one", version }),
    request("holders", { name: "Race two", version }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const after = await state();
  assert.equal(after.holders.length, before.holders.length + 1);
  assert.equal(after.revisions[0].version, version + 1);
  const exported = await request("export");
  assert.equal(exported.data.accounts.length, 3);
  assert.equal(exported.data.goals.length, 1);
  assert.equal((await request("auth/logout", {})).status, 200);
  assert.equal((await request("state")).status, 401);
  assert.equal((await request("state", null, "test-b")).status, 200);
  console.log(
    "Integration checks passed: authentication, origin protection, tenant isolation, D1 atomic transfers, FX cost conservation, replay validation, duplicate protection, concurrent writes, loans, goals, export.",
  );
} finally {
  // Terminate only the owned test server; retain its isolated D1 folder for diagnostics.
  if (server.exitCode === null && process.platform === "win32")
    execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  else if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
}
