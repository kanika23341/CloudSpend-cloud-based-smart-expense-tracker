"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { openDb } = require("../server/db");
const { createApp } = require("../server/app");
const { evaluateGoal } = require("../server/goals");
const { buildBreakdown } = require("../server/breakdown");

let server, base, n = 0;
test.before(async () => {
  const app = createApp({ db: openDb(":memory:"), jwtSecret: "t", rateLimiting: false });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function client() {
  let cookie = "";
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend", ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b), put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u) };
}

async function newUser() {
  const c = client();
  assert.equal((await c.post("/api/auth/register", { email: `g${++n}@example.com`, password: "Passw0rdOK" })).status, 201);
  return c;
}

const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const NEXT_YEAR = `${new Date().getUTCFullYear() + 1}-12-31`;

// A user with 20,000 in the savings wallet and no goals yet.
async function userWithWallet(amount = 20000) {
  const c = await newUser();
  await c.post("/api/incomes", { description: "Pay", amount: amount + 5000, date: TODAY });
  assert.equal((await c.post("/api/savings/transfers", { amount, date: TODAY })).status, 201);
  return c;
}

const goal = (over = {}) => ({ name: "Laptop", target: 30000, deadline: NEXT_YEAR, ...over });

// ---------- pure goal maths ----------

test("goal status rules", () => {
  const base = { targetPaise: 1000000, allocatedPaise: 400000, deadline: "2027-04-15", monthlyPaise: null, today: "2026-10-16" };
  // 6 months left (Oct -> Apr), 6,000 remaining => 1,000 a month needed
  const none = evaluateGoal(base);
  assert.equal(none.status, "no_plan");
  assert.equal(none.monthsLeft, 6);
  assert.equal(none.requiredPaise, 100000);

  assert.equal(evaluateGoal({ ...base, monthlyPaise: 100000 }).status, "on_track");   // exactly enough
  assert.equal(evaluateGoal({ ...base, monthlyPaise: 99999 }).status, "behind");     // one paisa short
  assert.equal(evaluateGoal({ ...base, allocatedPaise: 1000000 }).status, "completed");
  assert.equal(evaluateGoal({ ...base, allocatedPaise: 1200000 }).status, "completed"); // over-funded
  assert.equal(evaluateGoal({ ...base, deadline: "2026-09-30", monthlyPaise: 500000 }).status, "overdue");
  assert.equal(evaluateGoal({ ...base, deadline: "2026-10-30", monthlyPaise: 500000 }).status, "behind"); // due this month
});

test("projected completion and rounding up", () => {
  const r = evaluateGoal({ targetPaise: 1000000, allocatedPaise: 0, deadline: "2028-01-01", monthlyPaise: 300000, today: "2026-11-20" });
  assert.equal(r.projectedMonth, "2027-03");          // ceil(10,000 / 3,000) = 4 months after Nov
  assert.equal(r.requiredPaise, Math.ceil(1000000 / 14));
});

// ---------- goals API ----------

test("create, validate, edit and delete goals", async () => {
  const c = await newUser();
  assert.equal((await c.post("/api/goals", goal({ name: "" }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ target: 0 }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ target: 10.123 }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ deadline: "2020-01-01" }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ deadline: "2026-02-30" }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ deadline: "2101-01-01" }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ monthlyContribution: -5 }))).status, 400);
  assert.equal((await c.post("/api/goals", goal({ name: "x".repeat(61) }))).status, 400);

  const made = await c.post("/api/goals", goal({ monthlyContribution: 2500 }));
  assert.equal(made.status, 201);
  const g = made.json.goals[0];
  assert.deepEqual([g.priority, g.target, g.allocated, g.monthlyContribution], [1, 30000, 0, 2500]);

  const edited = await c.put(`/api/goals/${g.id}`, goal({ name: "Gaming laptop", target: 45000.5, monthlyContribution: "" }));
  assert.equal(edited.status, 200);
  assert.equal(edited.json.goals[0].name, "Gaming laptop");
  assert.equal(edited.json.goals[0].target, 45000.5);
  assert.equal(edited.json.goals[0].monthlyContribution, null);

  assert.equal((await c.del(`/api/goals/${g.id}`)).json.goals.length, 0);
  assert.equal((await c.del(`/api/goals/${g.id}`)).status, 404);
});

test("allocation draws only from the unallocated savings wallet", async () => {
  const c = await userWithWallet(20000);
  const a = (await c.post("/api/goals", goal({ name: "Laptop", target: 30000 }))).json.goals[0];
  const b = (await c.post("/api/goals", goal({ name: "Trip", target: 10000 }))).json.goals[1];

  let list = (await c.get("/api/goals")).json;
  assert.deepEqual(list.pool, { walletBalance: 20000, allocated: 0, totalSaved: 20000 });

  const ok = await c.post(`/api/goals/${a.id}/allocate`, { amount: 5000 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.goals[0].allocated, 5000);
  assert.equal(ok.json.goals[0].progressPercent, 16.7);
  // the money leaves the savings wallet and sits in the goal
  assert.deepEqual(ok.json.pool, { walletBalance: 15000, allocated: 5000, totalSaved: 20000 });
  const wallet = (await c.get("/api/savings?today=" + TODAY)).json.wallet;
  assert.equal(wallet.balance, 15000);
  assert.equal(wallet.allocatedToGoals, 5000);
  assert.equal(wallet.transferred, 20000);

  const tooMuch = await c.post(`/api/goals/${b.id}/allocate`, { amount: 15000 });   // exceeds what Trip needs
  assert.equal(tooMuch.status, 422);
  assert.match(tooMuch.json.error, /only needs ₹10,000\.00/);

  assert.equal((await c.post(`/api/goals/${a.id}/allocate`, { amount: 15000.01 })).status, 422); // exceeds pool
  assert.equal((await c.post(`/api/goals/${a.id}/allocate`, { amount: 0 })).status, 400);
  assert.equal((await c.post(`/api/goals/${a.id}/release`, { amount: 5000.01 })).status, 422);

  const rel = await c.post(`/api/goals/${a.id}/release`, { amount: 2000 });
  assert.equal(rel.json.pool.walletBalance, 17000);   // released money returns to the wallet
  assert.equal((await c.get("/api/savings?today=" + TODAY)).json.wallet.balance, 17000);
  assert.equal(rel.json.goals[0].allocated, 3000);
});

test("auto-allocate fills goals in priority order and reordering changes who is funded first", async () => {
  const c = await userWithWallet(20000);
  const first = (await c.post("/api/goals", goal({ name: "Laptop", target: 30000 }))).json.goals[0];
  const second = (await c.post("/api/goals", goal({ name: "Trip", target: 12000 }))).json.goals[1];

  let r = await c.post("/api/goals/auto-allocate");
  assert.equal(r.json.distributed, 20000);
  assert.deepEqual(r.json.goals.map((g) => [g.name, g.allocated]), [["Laptop", 20000], ["Trip", 0]]);
  assert.equal(r.json.pool.walletBalance, 0);

  // nothing left: a second run changes nothing
  r = await c.post("/api/goals/auto-allocate");
  assert.equal(r.json.distributed, 0);

  // make Trip the priority, free some money, and run again
  const re = await c.post("/api/goals/reorder", { ids: [second.id, first.id] });
  assert.deepEqual(re.json.goals.map((g) => [g.name, g.priority]), [["Trip", 1], ["Laptop", 2]]);
  await c.post(`/api/goals/${first.id}/release`, { amount: 15000 });
  r = await c.post("/api/goals/auto-allocate");
  assert.deepEqual(r.json.goals.map((g) => [g.name, g.allocated]), [["Trip", 12000], ["Laptop", 8000]]);
  assert.equal(r.json.goals[0].status, "completed");

  assert.equal((await c.post("/api/goals/reorder", { ids: [second.id] })).status, 400);
  assert.equal((await c.post("/api/goals/reorder", { ids: [second.id, second.id] })).status, 400);
});

test("allocated money can never exceed the savings wallet", async () => {
  const c = await userWithWallet(20000);
  const g = (await c.post("/api/goals", goal({ target: 30000 }))).json.goals[0];
  await c.post(`/api/goals/${g.id}/allocate`, { amount: 12000 });
  assert.equal((await c.get("/api/savings?today=" + TODAY)).json.wallet.balance, 8000);

  const transfers = (await c.get("/api/savings?today=" + TODAY)).json.transfers;
  const blocked = await c.del(`/api/savings/transfers/${transfers[0].id}`);   // wallet would drop to 0 < 12,000
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error, /Release it from your goals first/);

  // editing the target below the allocated amount is refused too
  const low = await c.put(`/api/goals/${g.id}`, goal({ target: 11000 }));
  assert.equal(low.status, 422);
  assert.match(low.json.error, /12,000\.00/);

  // deleting the goal returns the money to the pool, after which the transfer can go
  const afterDelete = await c.del(`/api/goals/${g.id}`);
  assert.equal(afterDelete.json.pool.walletBalance, 20000);   // deleting a goal returns its money
  assert.equal((await c.del(`/api/savings/transfers/${transfers[0].id}`)).status, 200);
});

test("allocating changes only the wallet balance, never monthly savings or the spending balance", async () => {
  const c = await userWithWallet(20000);
  const before = (await c.get("/api/savings?today=" + TODAY)).json;
  const g = (await c.post("/api/goals", goal())).json.goals[0];
  await c.post(`/api/goals/${g.id}/allocate`, { amount: 10000 });
  const after = (await c.get("/api/savings?today=" + TODAY)).json;
  assert.deepEqual(after.months, before.months);                                    // monthly savings unchanged
  assert.equal(after.wallet.availableToTransfer, before.wallet.availableToTransfer); // spending balance unchanged
  assert.equal(after.wallet.transferred, before.wallet.transferred);
  assert.equal(after.wallet.balance, before.wallet.balance - 10000);                 // only the wallet balance drops
  assert.equal(after.wallet.allocatedToGoals, 10000);
});

test("goals are private to each user", async () => {
  const a = await userWithWallet(20000);
  const b = await userWithWallet(20000);
  const g = (await a.post("/api/goals", goal())).json.goals[0];

  assert.equal((await b.get("/api/goals")).json.goals.length, 0);
  assert.equal((await b.put(`/api/goals/${g.id}`, goal())).status, 404);
  assert.equal((await b.del(`/api/goals/${g.id}`)).status, 404);
  assert.equal((await b.post(`/api/goals/${g.id}/allocate`, { amount: 100 })).status, 404);
  assert.equal((await b.post(`/api/goals/${g.id}/release`, { amount: 100 })).status, 404);
  assert.equal((await b.post("/api/goals/reorder", { ids: [g.id] })).status, 400);
  assert.equal((await a.get("/api/goals")).json.goals[0].allocated, 0);
});

test("a user can keep at most 50 goals", async () => {
  const c = await newUser();
  for (let i = 0; i < 50; i++) assert.equal((await c.post("/api/goals", goal({ name: `G${i}` }))).status, 201);
  assert.equal((await c.post("/api/goals", goal({ name: "One too many" }))).status, 422);
});

// ---------- breakdown maths ----------

test("breakdown: trends, shares, increases and the discretionary estimate", () => {
  const out = buildBreakdown({
    month: "2026-10",
    expenseByCategory: { Food: 600000, Shopping: 400000, Subscriptions: 100000, Bills: 900000 },
    previousByCategory: { Food: 400000, Shopping: 500000, Bills: 900000, Transport: 50000 },
    incomeSources: [{ name: "Salary", amountPaise: 4000000 }],
    discretionary: ["Shopping", "Subscriptions"],
    reducePercent: 20
  });

  const by = Object.fromEntries(out.expenses.categories.map((c) => [c.category, c]));
  assert.equal(out.expenses.total, 20000);
  assert.equal(out.expenses.previousTotal, 18500);
  assert.equal(out.expenses.change, 1500);
  assert.equal(out.expenses.changePercent, 8.1);

  assert.deepEqual([by.Food.trend, by.Food.change, by.Food.changePercent], ["up", 2000, 50]);
  assert.deepEqual([by.Shopping.trend, by.Shopping.change, by.Shopping.changePercent], ["down", -1000, -20]);
  assert.deepEqual([by.Subscriptions.trend, by.Subscriptions.changePercent], ["new", null]);
  assert.equal(by.Bills.trend, "same");
  assert.equal(by.Transport.trend, "down");                 // spent last month, nothing this month
  assert.equal(by.Transport.amount, 0);
  assert.equal(by.Food.sharePercent, 30);
  assert.deepEqual(out.expenses.categories.map((c) => c.category).slice(0, 2), ["Bills", "Food"]); // biggest first

  assert.deepEqual(out.increases.map((i) => i.category), ["Food", "Subscriptions"]);

  // 20% of (4,000 + 1,000) discretionary = 1,000 a month
  assert.equal(out.discretionary.total, 5000);
  assert.equal(out.discretionary.monthlySaving, 1000);
  assert.equal(out.discretionary.yearlySaving, 12000);
  assert.equal(out.net, 20000);
  assert.equal(out.discretionary.savingsAfterReduction, 21000);
  assert.equal(by.Shopping.potentialSaving, 800);
  assert.equal(by.Food.potentialSaving, 0);
  assert.equal(out.savingsRatePercent, 50);
});

test("breakdown: empty month does not divide by zero", () => {
  const out = buildBreakdown({ month: "2026-01", expenseByCategory: {}, previousByCategory: {}, incomeSources: [], discretionary: ["Shopping"], reducePercent: 10 });
  assert.equal(out.expenses.total, 0);
  assert.equal(out.expenses.changePercent, null);
  assert.equal(out.savingsRatePercent, null);
  assert.deepEqual(out.expenses.categories, []);
  assert.equal(out.discretionary.monthlySaving, 0);
  assert.equal(out.previousMonth, "2025-12");
});

// ---------- breakdown API ----------

test("breakdown API: groups by category, groups income by source, respects settings", async () => {
  const c = await newUser();
  const add = (description, amount, date, category) =>
    c.post("/api/expenses", { description, amount, date, category, payment: "UPI" });

  await add("Lunch", 300, "2026-09-10", "Food");
  await add("Dinner", 700, "2026-10-10", "Food");
  await add("Shoes", 2000, "2026-10-11", "Shopping");
  await add("Streaming", 199.5, "2026-10-12", "Subscriptions");
  await c.post("/api/incomes", { description: "Salary", amount: 30000, date: "2026-10-01" });
  await c.post("/api/incomes", { description: " salary ", amount: 500, date: "2026-10-15" });
  await c.post("/api/incomes", { description: "Freelance", amount: 4500, date: "2026-10-20" });

  const r = (await c.get("/api/breakdown?month=2026-10")).json;
  assert.equal(r.expenses.total, 2899.5);
  assert.equal(r.income.total, 35000);
  assert.deepEqual(r.income.sources.map((s) => [s.name, s.amount]), [["Salary", 30500], ["Freelance", 4500]]);
  const food = r.expenses.categories.find((x) => x.category === "Food");
  assert.deepEqual([food.amount, food.previous, food.trend, food.changePercent], [700, 300, "up", 133.3]);
  assert.deepEqual(r.discretionary.categories, ["Entertainment", "Shopping", "Subscriptions"]);  // defaults
  assert.equal(r.discretionary.total, 2199.5);
  assert.equal(r.discretionary.monthlySaving, 439.9);

  const put = await c.put("/api/settings/discretionary", { categories: ["Food"] });
  assert.deepEqual(put.json.categories, ["Food"]);
  const r2 = (await c.get("/api/breakdown?month=2026-10&reduce=50")).json;
  assert.equal(r2.discretionary.total, 700);
  assert.equal(r2.discretionary.monthlySaving, 350);

  assert.equal((await c.put("/api/settings/discretionary", { categories: ["Nope"] })).status, 400);
  assert.equal((await c.put("/api/settings/discretionary", { categories: "Food" })).status, 400);
  assert.equal((await c.get("/api/breakdown?month=2026-13")).status, 400);
  assert.equal((await c.get("/api/breakdown")).status, 400);
  assert.equal((await c.get("/api/breakdown?month=2026-10&reduce=0")).status, 400);
  assert.equal((await c.get("/api/breakdown?month=2026-10&reduce=20.5")).status, 400);
});

test("breakdown API is private to each user", async () => {
  const a = await newUser();
  const b = await newUser();
  await a.post("/api/expenses", { description: "Rent", amount: 9000, date: "2026-10-01", category: "Bills", payment: "UPI" });
  await a.put("/api/settings/discretionary", { categories: ["Bills"] });

  const seen = (await b.get("/api/breakdown?month=2026-10")).json;
  assert.equal(seen.expenses.total, 0);
  assert.deepEqual(seen.discretionary.categories, ["Entertainment", "Shopping", "Subscriptions"]);
});

test("an older database gains the new settings column and goals table", () => {
  const Database = require("better-sqlite3");
  const fs = require("fs"), os = require("os"), path = require("path");
  const file = path.join(os.tmpdir(), `cs-old-${Date.now()}.db`);
  const old = new Database(file);
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT);" +
           "CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, monthly_income_default_paise INTEGER, pleasures_json TEXT);");
  old.close();

  const db = openDb(file);
  assert.ok(db.prepare("PRAGMA table_info(user_settings)").all().some((c) => c.name === "discretionary_json"));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'goals'").get());
  db.close();
  fs.rmSync(file, { force: true });
});
