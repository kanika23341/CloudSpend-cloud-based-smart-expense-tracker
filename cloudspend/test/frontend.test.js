"use strict";

// Runs the real dashboard (views/index.html + public/app.js) in jsdom against the real server.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { openDb } = require("../server/db");
const { createApp } = require("../server/app");

let server, base;
const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test.before(async () => {
  const app = createApp({ db: openDb(":memory:"), jwtSecret: "t", rateLimiting: false });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function signUp(email) {
  const res = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "cloudspend" },
    body: JSON.stringify({ email, password: "Passw0rdOK" })
  });
  assert.equal(res.status, 201);
  return res.headers.get("set-cookie").split(";")[0];
}

const until = async (fn, label, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  assert.fail(`timed out waiting for: ${label}`);
};

async function openDashboard(cookie) {
  const html = (await (await fetch(base + "/", { headers: { Cookie: cookie } })).text()).replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: base + "/", pretendToBeVisual: true });
  const w = dom.window;
  const charts = [];
  const alerts = [];
  w.Chart = function (_c, cfg) { charts.push(cfg); this.destroy = () => {}; };
  w.CSS = { escape: (s) => s };
  w.alert = (m) => alerts.push(m);
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  w.fetch = (url, opts = {}) => fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), Cookie: cookie } });
  w.eval(appJs); // jsdom fires DOMContentLoaded itself once the document is ready
  await new Promise((r) => setTimeout(r, 30));
  const $ = (id) => w.document.getElementById(id);
  const submit = (id) => $(id).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  const click = (id) => $(id).dispatchEvent(new w.Event("click", { bubbles: true }));
  const text = (id) => $(id).textContent;
  return { w, $, submit, click, text, charts, alerts };
}

const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};

test("dashboard: savings flow end to end, persisted per user", async () => {
  const cookie = await signUp("ui@example.com");
  const ui = await openDashboard(cookie);

  await until(() => ui.text("userEmail") === "ui@example.com", "bootstrap");
  await until(() => ui.text("savingsStatus") === "No goal set", "savings loaded");
  assert.match(ui.text("savingsNote"), /No income or expenses/);
  assert.equal(ui.text("savingsWalletBalance"), "₹0.00");
  assert.equal(ui.$("savingsTransferSubmit").disabled, true); // nothing to move yet
  assert.match(ui.text("savingsHistory"), /No history yet/);

  // income 30,000 and expense 12,000.50 through the real forms
  ui.$("incomeDescription").value = "Salary";
  ui.$("incomeAmount").value = "30000";
  ui.submit("incomeEntryForm");
  await until(() => ui.text("walletBalance") === "₹30,000.00", "income saved");

  ui.$("description").value = "Rent";
  ui.$("amount").value = "12000.50";
  ui.$("date").value = today();
  ui.submit("expense-form");
  await until(() => ui.text("walletBalance") === "₹17,999.50", "expense saved");
  await until(() => ui.text("savingsActual") === "₹17,999.50", "monthly savings = income - expenses");
  assert.match(ui.text("savingsBreakdown"), /Income ₹30,000\.00 minus expenses ₹12,000\.50/);

  // goal: set, then edit
  ui.$("savingsTargetAmount").value = "20000";
  ui.submit("savingsGoalForm");
  await until(() => ui.text("savingsTarget") === "₹20,000.00", "goal saved");
  assert.equal(ui.text("savingsStatus"), "In progress");
  assert.equal(ui.text("savingsPercent"), "90%");
  assert.equal(ui.text("savingsRemaining"), "₹2,000.50");
  assert.equal(ui.text("savingsGoalSubmit"), "Update goal");

  ui.$("savingsTargetAmount").value = "15000";
  ui.submit("savingsGoalForm");
  await until(() => ui.text("savingsStatus") === "Goal met", "goal edited");
  assert.equal(ui.text("savingsPercent"), "120%");
  assert.equal(ui.$("savingsProgressFill").style.width, "100%");

  // transfer to the savings wallet: wallet moves, monthly savings do not
  ui.$("savingsTransferAmount").value = "10000";
  ui.$("savingsTransferNote").value = "Emergency fund";
  ui.submit("savingsTransferForm");
  await until(() => ui.text("savingsWalletBalance") === "₹10,000.00", "transfer saved");
  assert.equal(ui.text("savingsActual"), "₹17,999.50");          // not double counted
  assert.equal(ui.text("savingsAvailable"), "₹7,999.50");
  assert.equal(ui.text("walletBalance"), "₹7,999.50");           // main wallet reduced once
  assert.match(ui.text("savingsTransfers"), /Emergency fund/);

  // over-transfer shows an inline error, not a crash
  ui.$("savingsTransferAmount").value = "9000";
  ui.submit("savingsTransferForm");
  await until(() => !ui.$("savingsTransferError").hidden, "inline error");
  assert.match(ui.text("savingsTransferError"), /7,999\.50/);

  // month navigation and history
  ui.click("savingsPrevMonth");
  assert.equal(ui.$("savingsThisMonth").hidden, false);
  assert.equal(ui.text("savingsStatus"), "No goal set");
  ui.click("savingsThisMonth");
  assert.equal(ui.$("savingsThisMonth").hidden, true);
  assert.equal(ui.text("savingsStatus"), "Goal met");
  assert.match(ui.text("savingsHistory"), /₹15,000\.00/);

  // chart data: actual savings vs goal
  const cfg = ui.charts[ui.charts.length - 1];
  assert.equal(cfg.data.datasets[0].label, "Actual savings");
  assert.equal(cfg.data.datasets[1].label, "Monthly goal");
  assert.equal(cfg.data.datasets[0].data.at(-1), 17999.5);
  assert.equal(cfg.data.datasets[1].data.at(-1), 15000);

  // remove goal
  ui.click("savingsRemoveTarget");
  await until(() => ui.text("savingsStatus") === "No goal set", "goal removed");
  assert.equal(ui.text("savingsActual"), "₹17,999.50");

  // everything persists across a fresh page load
  const again = await openDashboard(cookie);
  await until(() => again.text("savingsWalletBalance") === "₹10,000.00", "persisted wallet");
  await until(() => again.text("walletBalance") === "₹7,999.50", "persisted balance");
  // the only alert is the pre-existing "income added" confirmation; no error alerts
  const errors = (list) => list.filter((m) => !/added to your wallet/.test(m));
  assert.deepEqual(errors(again.alerts), []);
  assert.deepEqual(errors(ui.alerts), []);
});

test("dashboard: another user sees none of it", async () => {
  const ui = await openDashboard(await signUp("other@example.com"));
  await until(() => ui.text("userEmail") === "other@example.com", "bootstrap");
  await until(() => ui.text("savingsStatus") === "No goal set", "loaded");
  assert.equal(ui.text("walletBalance"), "₹0.00");
  assert.equal(ui.text("savingsWalletBalance"), "₹0.00");
  assert.match(ui.text("savingsTransfers"), /No transfers yet/);
});

test("dashboard: shows an error state when the server is unreachable", async () => {
  const ui = await openDashboard(await signUp("down@example.com"));
  await until(() => ui.text("savingsStatus") === "No goal set", "loaded");
  ui.w.fetch = () => Promise.reject(new Error("offline"));
  ui.click("savingsRetry");
  await until(() => !ui.$("savingsError").hidden, "error banner");
  assert.match(ui.text("savingsErrorText"), /Could not reach the server/);
});

test("pages: every id the dashboard script uses exists in the markup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "views", "index.html"), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...appJs.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test("dashboard: spending breakdown and savings goals end to end", async () => {
  const ui = await openDashboard(await signUp("goals@example.com"));
  await until(() => ui.text("userEmail") === "goals@example.com", "bootstrap");
  const { w, $ } = ui;
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event("change", { bubbles: true })); };
  const year = new Date().getFullYear() + 1;

  // empty states first
  await until(() => /No goals yet/.test(ui.text("goalList")), "goals empty state");
  assert.equal($("goalsAutoAllocate").disabled, true);
  await until(() => /No expenses recorded/.test(ui.text("breakdownCategories")), "breakdown empty state");

  // income and three categorised expenses
  $("incomeDescription").value = "Salary"; $("incomeAmount").value = "50000";
  ui.submit("incomeEntryForm");
  await until(() => ui.text("walletBalance") === "₹50,000.00", "income");
  for (const [name, amount, category] of [["Groceries", "1000", "Food"], ["Sneakers", "2000", "Shopping"], ["Streaming", "500", "Subscriptions"]]) {
    $("description").value = name; $("amount").value = amount; $("category").value = category; $("date").value = today();
    ui.submit("expense-form");
    await until(() => w.document.body.textContent.includes(name), `expense ${name}`);
  }

  // ----- breakdown -----
  await until(() => ui.text("bdExpenses") === "₹3,500.00", "breakdown totals");
  assert.equal(ui.text("bdIncome"), "₹50,000.00");
  assert.equal(ui.text("bdNet"), "₹46,500.00");
  assert.match(ui.text("bdNetNote"), /Savings rate 93%/);
  assert.match(ui.text("breakdownCategories"), /Food/);
  assert.match(ui.text("breakdownCategories"), /Subscriptions/);
  assert.match(ui.text("breakdownCategories"), /New/);                  // nothing last month
  assert.match(ui.text("breakdownIncome"), /Salary/);
  assert.equal(ui.text("bdDiscretionary"), "₹2,500.00");               // Shopping + Subscriptions by default
  assert.equal(ui.text("bdMonthlySaving"), "₹500.00");                 // 20%
  assert.equal(ui.text("bdYearlySaving"), "₹6,000.00");
  assert.equal(ui.text("bdAfter"), "₹47,000.00");

  change("breakdownReduce", "50");
  await until(() => ui.text("bdMonthlySaving") === "₹1,250.00", "reduction changed");

  const subs = [...$("discretionaryChecks").querySelectorAll("input")].find((i) => i.value === "Subscriptions");
  subs.checked = false;
  subs.dispatchEvent(new w.Event("change", { bubbles: true }));
  await until(() => ui.text("bdDiscretionary") === "₹2,000.00", "discretionary categories saved");
  assert.equal(ui.text("bdMonthlySaving"), "₹1,000.00");

  ui.click("breakdownPrev");
  assert.equal($("breakdownThis").hidden, false);
  await until(() => /No expenses recorded/.test(ui.text("breakdownCategories")), "previous month empty");
  ui.click("breakdownThis");
  await until(() => ui.text("bdExpenses") === "₹3,500.00", "back to this month");
  const chart = ui.charts.filter((c) => c.data.datasets[0].data.length).at(-1);
  assert.deepEqual([...chart.data.labels].sort(), ["Food", "Shopping", "Subscriptions"]);
  assert.deepEqual(Array.from(chart.data.datasets.map((d) => d.data.reduce((a, b) => a + b, 0))), [3500, 0]); // this month vs last month

  // ----- goals -----
  ui.$("savingsTransferAmount").value = "20000";
  ui.submit("savingsTransferForm");
  await until(() => ui.text("goalsWallet") === "₹20,000.00", "wallet funded");

  const newGoal = async (name, target, monthly) => {
    ui.click("goalNew");
    assert.equal($("goalDialog").hasAttribute("open"), true);
    $("goalName").value = name; $("goalTarget").value = target; $("goalDeadline").value = `${year}-06-30`; $("goalMonthly").value = monthly;
    ui.submit("goalForm");
    await until(() => ui.text("goalList").includes(name), `goal ${name}`);
  };

  ui.click("goalNew");
  ui.submit("goalForm");                                                // empty form
  assert.match(ui.text("goalFormError"), /name/);
  ui.click("goalCancel");

  await newGoal("Laptop", "30000", "");
  await newGoal("Trip", "12000", "2000");
  const cards = () => [...w.document.querySelectorAll(".goal-card")];
  assert.equal(cards().length, 2);
  assert.match(cards()[0].textContent, /No plan yet/);
  assert.match(cards()[1].textContent, /Behind plan|On track/);

  const act = (card, action) => card.querySelector(`[data-goal-action="${action}"]`).dispatchEvent(new w.Event("click", { bubbles: true }));

  // manual allocation, then an over-allocation is refused inline
  cards()[0].querySelector("input").value = "5000";
  act(cards()[0], "allocate");
  await until(() => ui.text("goalsAllocated") === "₹5,000.00", "allocated");
  assert.match(cards()[0].textContent, /₹5,000\.00 of ₹30,000\.00/);
  assert.equal(ui.text("goalsWallet"), "₹15,000.00");
  assert.equal(ui.text("goalsTotal"), "₹20,000.00");
  // the Savings page wallet drops by the allocated amount; the spending balance does not move
  await until(() => ui.text("savingsWalletBalance") === "₹15,000.00", "savings wallet reduced");
  assert.match(ui.text("savingsWalletGoals"), /₹5,000\.00 of your ₹20,000\.00 savings is allocated to goals/);
  assert.equal(ui.text("walletBalance"), "₹26,500.00");

  cards()[1].querySelector("input").value = "99999";
  act(cards()[1], "allocate");
  await until(() => !cards()[1].querySelector(".goal-card-error").hidden, "inline allocation error");
  assert.match(cards()[1].querySelector(".goal-card-error").textContent, /savings wallet only has ₹15,000\.00 left/);

  // priority: move Trip to the top and distribute the rest
  act(cards()[1], "up");
  await until(() => /Trip/.test(cards()[0].textContent), "reordered");
  ui.click("goalsAutoAllocate");
  await until(() => ui.text("goalsWallet") === "₹0.00", "distributed by priority");
  assert.match(cards()[0].textContent, /Completed/);                    // Trip filled first (12,000)
  assert.match(cards()[0].textContent, /₹12,000\.00 of ₹12,000\.00/);
  assert.match(cards()[1].textContent, /₹8,000\.00 of ₹30,000\.00/);   // Laptop gets the remaining 3,000 on top of 5,000
  assert.equal($("goalsAutoAllocate").disabled, true);

  // monthly savings are untouched by all of this
  assert.equal(ui.text("savingsActual"), "₹46,500.00");

  // releasing and deleting give money back
  cards()[1].querySelector("input").value = "1000";
  act(cards()[1], "release");
  await until(() => ui.text("goalsWallet") === "₹1,000.00", "released");
  act(cards()[0], "delete");
  await until(() => cards().length === 1, "goal deleted");
  assert.equal(ui.text("goalsWallet"), "₹13,000.00");
  await until(() => ui.text("savingsWalletBalance") === "₹13,000.00", "savings wallet after delete");

  // editing validates against what is already allocated
  act(cards()[0], "edit");
  assert.equal($("goalName").value, "Laptop");
  $("goalTarget").value = "100";
  ui.submit("goalForm");
  await until(() => !$("goalFormError").hidden, "edit rejected");
  assert.match(ui.text("goalFormError"), /already allocated/);
  $("goalTarget").value = "40000"; $("goalName").value = "Gaming laptop";
  ui.submit("goalForm");
  await until(() => /Gaming laptop/.test(ui.text("goalList")), "edit saved");

  assert.deepEqual(ui.alerts.filter((m) => !/added to your wallet/.test(m)), []);
});
