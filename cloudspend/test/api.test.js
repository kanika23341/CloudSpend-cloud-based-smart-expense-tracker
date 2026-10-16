"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../server/db");
const { createApp } = require("../server/app");
const { buildSavings, goalStatus } = require("../server/savings");

let server, base;

test.before(async () => {
  const app = createApp({ db: openDb(":memory:"), jwtSecret: "test-secret", rateLimiting: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// Minimal cookie-aware client
function client() {
  let cookie = "";
  const call = async (method, url, body, extraHeaders = {}) => {
    const res = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend", ...(cookie && { Cookie: cookie }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, res };
  };
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u), call };
}

const PASSWORD = "Sup3rsecret";
let n = 0;
async function newUser() {
  const c = client();
  const r = await c.post("/api/auth/register", { email: `user${++n}@example.com`, password: PASSWORD });
  assert.equal(r.status, 201);
  return c;
}

// ---------- pure savings maths ----------

test("monthly saved = income - expenses, transfers never double count", () => {
  const out = buildSavings({
    incomeByMonth: { "2026-09": 5000000, "2026-10": 4000000 },
    expenseByMonth: { "2026-09": 3000000, "2026-10": 4500000 },
    targetByMonth: { "2026-09": 2000000, "2026-10": 1000000 },
    transfers: [{ amountPaise: 1500000 }],
    currentMonth: "2026-10"
  });
  const [sep, oct] = out.months;
  assert.equal(sep.saved, 20000);
  assert.equal(sep.status, "met");
  assert.equal(sep.progressPercent, 100);
  assert.equal(oct.saved, -5000);                 // overspent month
  assert.equal(oct.progressPercent, 0);           // never negative
  assert.equal(oct.remaining, 15000);          // target 10,000 from a -5,000 start
  assert.equal(oct.status, "in_progress");
  assert.equal(out.wallet.balance, 15000);
  assert.equal(out.wallet.cumulativeSaved, 15000);
  assert.equal(out.wallet.availableToTransfer, 0); // 15000 saved - 15000 moved
});

test("goal status rules", () => {
  const base = { targetPaise: 1000, savedPaise: 500, currentMonth: "2026-10" };
  assert.equal(goalStatus({ ...base, month: "2026-09" }), "missed");
  assert.equal(goalStatus({ ...base, month: "2026-10" }), "in_progress");
  assert.equal(goalStatus({ ...base, month: "2026-11" }), "upcoming");
  assert.equal(goalStatus({ ...base, savedPaise: 1000, month: "2026-09" }), "met");
  assert.equal(goalStatus({ ...base, targetPaise: 0, month: "2026-10" }), "no_target");
});

test("months are contiguous and include gaps", () => {
  const out = buildSavings({
    incomeByMonth: { "2026-01": 100 }, expenseByMonth: {}, targetByMonth: {}, transfers: [], currentMonth: "2026-04"
  });
  assert.deepEqual(out.months.map((m) => m.month), ["2026-01", "2026-02", "2026-03", "2026-04"]);
});

test("amounts keep paise precision", () => {
  const out = buildSavings({
    incomeByMonth: { "2026-10": 10 }, expenseByMonth: { "2026-10": 1 + 20 }, targetByMonth: {}, transfers: [], currentMonth: "2026-10"
  });
  assert.equal(out.months[0].saved, -0.11);
});

// ---------- auth ----------

test("registration validates input", async () => {
  const c = client();
  assert.equal((await c.post("/api/auth/register", { email: "nope", password: PASSWORD })).status, 400);
  assert.equal((await c.post("/api/auth/register", { email: "a@b.co", password: "short1" })).status, 400);
  assert.equal((await c.post("/api/auth/register", { email: "a@b.co", password: "onlyletters" })).status, 400);
  assert.equal((await c.post("/api/auth/register", { email: "a@b.co", password: "12345678" })).status, 400);
});

test("duplicate email is rejected, case-insensitively", async () => {
  const c = client();
  await c.post("/api/auth/register", { email: "dupe@example.com", password: PASSWORD });
  const r = await client().post("/api/auth/register", { email: "DUPE@example.com", password: PASSWORD });
  assert.equal(r.status, 409);
});

test("login, session cookie flags, logout", async () => {
  const email = "login@example.com";
  await client().post("/api/auth/register", { email, password: PASSWORD });

  const c = client();
  assert.equal((await c.post("/api/auth/login", { email, password: "Wrong1234" })).status, 401);
  assert.equal((await c.post("/api/auth/login", { email: "ghost@example.com", password: PASSWORD })).status, 401);

  const ok = await c.post("/api/auth/login", { email, password: PASSWORD });
  assert.equal(ok.status, 200);
  const cookie = ok.res.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  assert.equal((await c.get("/api/auth/me")).json.user.email, email);
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/auth/me")).status, 401);
});

test("passwords are hashed, never stored in plain text", async () => {
  const { openDb: open } = require("../server/db");
  const db = open(":memory:");
  const app = createApp({ db, jwtSecret: "x", rateLimiting: false });
  const s = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend" },
    body: JSON.stringify({ email: "h@example.com", password: PASSWORD })
  });
  assert.equal(res.status, 201);
  const row = db.prepare("SELECT password_hash FROM users").get();
  assert.notEqual(row.password_hash, PASSWORD);
  assert.match(row.password_hash, /^\$2[aby]\$12\$/);
  s.close();
});

test("protected API and pages require a session", async () => {
  const c = client();
  for (const url of ["/api/bootstrap", "/api/savings", "/api/auth/me"]) {
    assert.equal((await c.get(url)).status, 401, url);
  }
  const home = await fetch(base + "/", { redirect: "manual" });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login");
  assert.equal((await fetch(base + "/login")).status, 200);
  assert.equal((await fetch(base + "/index.html")).status, 404); // dashboard HTML is not a public static file
});

test("state-changing requests need the custom header", async () => {
  const c = await newUser();
  const r = await c.call("POST", "/api/expenses", { description: "x", amount: 1, date: "2026-10-01" }, { "X-Requested-With": "" });
  assert.equal(r.status, 403);
});

// ---------- data isolation ----------

test("users cannot see or modify each other's data", async () => {
  const a = await newUser();
  const b = await newUser();

  const exp = (await a.post("/api/expenses", { description: "Rent", amount: 100, date: "2026-10-01", category: "Bills", payment: "UPI" })).json.expense;
  await a.post("/api/incomes", { description: "Pay", amount: 500, date: "2026-10-01" });
  await a.put("/api/savings/targets/2026-10", { target: 100 });
  const tr = (await a.post("/api/savings/transfers", { amount: 50, date: "2026-10-02", note: "x" })).json.transfer;

  const seenByB = (await b.get("/api/bootstrap")).json;
  assert.equal(seenByB.expenses.length, 0);
  assert.equal(seenByB.incomes.length, 0);

  const savingsB = (await b.get("/api/savings?today=2026-10-10")).json;
  assert.equal(savingsB.transfers.length, 0);
  assert.equal(savingsB.wallet.balance, 0);
  assert.equal(savingsB.months.find((m) => m.month === "2026-10").target, null);

  assert.equal((await b.del(`/api/expenses/${exp.id}`)).status, 404);
  assert.equal((await b.del(`/api/savings/transfers/${tr.id}`)).status, 404);
  assert.equal((await b.del("/api/savings/targets/2026-10")).status, 404);

  // A's data is untouched
  assert.equal((await a.get("/api/bootstrap")).json.expenses.length, 1);
  assert.equal((await a.get("/api/savings?today=2026-10-10")).json.transfers.length, 1);
});

// ---------- savings behaviour end to end ----------

test("targets can be set, edited, removed and validated", async () => {
  const c = await newUser();
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: 5000 })).status, 200);
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: 7500.5 })).json.target, 7500.5);
  assert.equal((await c.put("/api/savings/targets/2026-13", { target: 100 })).status, 400);
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: 0 })).status, 400);
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: -5 })).status, 400);
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: 10.123 })).status, 400);
  assert.equal((await c.put("/api/savings/targets/2026-10", { target: "abc" })).status, 400);

  const m = (await c.get("/api/savings?today=2026-10-16")).json.months.find((x) => x.month === "2026-10");
  assert.equal(m.target, 7500.5);

  assert.equal((await c.del("/api/savings/targets/2026-10")).status, 200);
  const after = (await c.get("/api/savings?today=2026-10-16")).json.months.find((x) => x.month === "2026-10");
  assert.equal(after.target, null);
  assert.equal(after.status, "no_target");
});

test("monthly savings are derived and unaffected by transfers", async () => {
  const c = await newUser();
  await c.post("/api/incomes", { description: "Salary", amount: 30000, date: "2026-10-01" });
  await c.post("/api/expenses", { description: "Rent", amount: 12000.5, date: "2026-10-03", category: "Bills", payment: "UPI" });
  await c.put("/api/savings/targets/2026-10", { target: 15000 });

  const before = (await c.get("/api/savings?today=2026-10-16")).json;
  const oct = before.months.find((m) => m.month === "2026-10");
  assert.equal(oct.saved, 17999.5);
  assert.equal(oct.status, "met");
  assert.equal(oct.progressPercent, 120);
  assert.equal(before.wallet.availableToTransfer, 17999.5);

  const t = await c.post("/api/savings/transfers", { amount: 10000, date: "2026-10-05", note: "Emergency fund" });
  assert.equal(t.status, 201);

  const after = (await c.get("/api/savings?today=2026-10-16")).json;
  const oct2 = after.months.find((m) => m.month === "2026-10");
  assert.equal(oct2.saved, 17999.5);              // unchanged: no double counting
  assert.equal(after.wallet.balance, 10000);
  assert.equal(after.wallet.availableToTransfer, 7999.5);

  // cannot move more than what is left
  const over = await c.post("/api/savings/transfers", { amount: 8000, date: "2026-10-06" });
  assert.equal(over.status, 422);
  assert.match(over.json.error, /7,999\.50/);
  assert.equal((await c.post("/api/savings/transfers", { amount: 7999.5, date: "2026-10-06" })).status, 201);
  assert.equal((await c.post("/api/savings/transfers", { amount: 0.01, date: "2026-10-06" })).status, 422);

  // removing a transfer returns it to the available balance
  const list = (await c.get("/api/savings?today=2026-10-16")).json.transfers;
  await c.del(`/api/savings/transfers/${list[0].id}`);
  assert.equal((await c.get("/api/savings?today=2026-10-16")).json.wallet.availableToTransfer, 7999.5);
});

test("transfer validation: dates and amounts", async () => {
  const c = await newUser();
  await c.post("/api/incomes", { description: "Pay", amount: 1000, date: "2026-10-01" });
  assert.equal((await c.post("/api/savings/transfers", { amount: 10, date: "2999-01-01" })).status, 400);
  assert.equal((await c.post("/api/savings/transfers", { amount: 10, date: "2026-02-30" })).status, 400);
  assert.equal((await c.post("/api/savings/transfers", { amount: -1, date: "2026-10-01" })).status, 400);
  assert.equal((await c.post("/api/savings/transfers", { amount: 1.005, date: "2026-10-01" })).status, 400);
  assert.equal((await c.post("/api/savings/transfers", { amount: 10, date: "2026-10-01", note: "x".repeat(81) })).status, 400);
});

test("history spans months with gaps and negative months", async () => {
  const c = await newUser();
  await c.post("/api/incomes", { description: "Pay", amount: 1000, date: "2026-07-05" });
  await c.post("/api/expenses", { description: "Trip", amount: 1500, date: "2026-09-05", category: "Other", payment: "Cash" });
  const months = (await c.get("/api/savings?today=2026-10-16")).json.months;
  assert.deepEqual(months.map((m) => [m.month, m.saved]), [
    ["2026-07", 1000], ["2026-08", 0], ["2026-09", -1500], ["2026-10", 0]
  ]);
});

test("expenses, incomes and settings persist per user", async () => {
  const c = await newUser();
  const e = await c.post("/api/expenses", { description: "Tea", amount: 15, date: "2026-10-16", category: "Food", payment: "Cash", source: "pleasure", pleasureId: "p1" });
  assert.equal(e.status, 201);
  assert.equal((await c.post("/api/expenses", { description: "", amount: 15, date: "2026-10-16" })).status, 400);
  assert.equal((await c.post("/api/incomes", { description: "Pay", amount: 100, date: "bad" })).status, 400);
  assert.equal((await c.put("/api/settings", { monthlyIncomeDefault: 25000 })).status, 200);
  assert.equal((await c.put("/api/pleasures", { pleasures: [{ id: "p1", name: "Tea", emoji: "T", amount: 15, category: "Food", payment: "Cash" }] })).status, 200);

  const boot = (await c.get("/api/bootstrap")).json;
  assert.equal(boot.expenses[0].pleasureId, "p1");
  assert.equal(boot.settings.monthlyIncomeDefault, 25000);
  assert.equal(boot.settings.pleasures[0].name, "Tea");

  assert.equal((await c.del(`/api/expenses/${e.json.expense.id}`)).status, 200);
  assert.equal((await c.get("/api/bootstrap")).json.expenses.length, 0);
});

test("env loader reads .env files with Windows line endings and a BOM", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { loadEnv } = require("../server/env");
  const file = path.join(os.tmpdir(), `cs-env-${Date.now()}.env`);
  fs.writeFileSync(file, "\uFEFF# comment\r\nCS_TEST_A=hello\r\nCS_TEST_B=\"quoted value\"\r\nCS_TEST_EMPTY=\r\n");
  delete process.env.CS_TEST_A; delete process.env.CS_TEST_B; delete process.env.CS_TEST_EMPTY;
  process.env.CS_TEST_KEEP = "real";
  fs.appendFileSync(file, "CS_TEST_KEEP=fromfile\r\n");
  assert.equal(loadEnv(file).loaded, true);
  assert.equal(process.env.CS_TEST_A, "hello");
  assert.equal(process.env.CS_TEST_B, "quoted value");
  assert.equal(process.env.CS_TEST_EMPTY, undefined);
  assert.equal(process.env.CS_TEST_KEEP, "real"); // real environment wins
  fs.unlinkSync(file);
  assert.equal(loadEnv(file).loaded, false);
});

test("pages are served even when the project path contains a dot-folder", async () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const dir = path.join(os.tmpdir(), `.hidden-${Date.now()}`, "cloudspend");
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(__dirname, "..", "server"), path.join(dir, "server"), { recursive: true });
  fs.cpSync(path.join(__dirname, "..", "views"), path.join(dir, "views"), { recursive: true });
  fs.cpSync(path.join(__dirname, "..", "public"), path.join(dir, "public"), { recursive: true });
  fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"));

  const { createApp: create } = require(path.join(dir, "server", "app.js"));
  const app = create({ db: openDb(":memory:"), jwtSecret: "x", rateLimiting: false });
  const s = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
  const url = `http://127.0.0.1:${s.address().port}`;
  assert.equal((await fetch(`${url}/login`)).status, 200);
  assert.equal((await fetch(`${url}/register`)).status, 200);
  assert.equal((await fetch(`${url}/app.js`)).status, 200);
  s.close();
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});
