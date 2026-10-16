"use strict";

const { fromPaise } = require("./validate");

const monthOf = (date) => date.slice(0, 7);

function nextMonth(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Status of one month's goal.
 *  met         saved >= target
 *  missed      past month that ended below target
 *  in_progress current month, below target
 *  upcoming    future month with a target
 *  no_target   nothing to measure against
 */
function goalStatus({ targetPaise, savedPaise, month, currentMonth }) {
  if (!targetPaise) return "no_target";
  if (savedPaise >= targetPaise) return "met";
  if (month < currentMonth) return "missed";
  if (month > currentMonth) return "upcoming";
  return "in_progress";
}

/**
 * Pure calculation. All inputs are integer paise.
 *
 *   monthly saved = income(month) - expenses(month)
 *   transfers are excluded from monthly saved (they only relocate money that
 *   was already saved), so they can never be counted twice.
 *
 *   transferred (total saved)   = sum(transfers)
 *   allocated to goals          = sum(goal allocations); that money leaves the wallet
 *   savings wallet balance      = transferred - allocated to goals
 *   available to transfer    = sum(income) - sum(expenses) - sum(transfers)
 */
function buildSavings({ incomeByMonth, expenseByMonth, targetByMonth, transfers, currentMonth, allocatedPaise = 0 }) {
  const allMonths = [
    currentMonth,
    ...Object.keys(incomeByMonth),
    ...Object.keys(expenseByMonth),
    ...Object.keys(targetByMonth)
  ].sort();

  const first = allMonths[0];
  const last = allMonths[allMonths.length - 1];

  const months = [];
  for (let key = first; key <= last; key = nextMonth(key)) {
    const income = incomeByMonth[key] || 0;
    const expenses = expenseByMonth[key] || 0;
    const saved = income - expenses;
    const target = targetByMonth[key] || 0;
    const status = goalStatus({ targetPaise: target, savedPaise: saved, month: key, currentMonth });

    months.push({
      month: key,
      income: fromPaise(income),
      expenses: fromPaise(expenses),
      saved: fromPaise(saved),
      target: target ? fromPaise(target) : null,
      progressPercent: target ? Math.max(0, Math.round((saved / target) * 1000) / 10) : null,
      remaining: target ? fromPaise(Math.max(0, target - saved)) : null,
      status
    });
  }

  const totalIncome = Object.values(incomeByMonth).reduce((a, b) => a + b, 0);
  const totalExpenses = Object.values(expenseByMonth).reduce((a, b) => a + b, 0);
  const transferred = transfers.reduce((sum, t) => sum + t.amountPaise, 0);

  return {
    currentMonth,
    months,
    wallet: {
      balance: fromPaise(transferred - allocatedPaise),
      transferred: fromPaise(transferred),
      allocatedToGoals: fromPaise(allocatedPaise),
      availableToTransfer: fromPaise(totalIncome - totalExpenses - transferred),
      totalIncome: fromPaise(totalIncome),
      totalExpenses: fromPaise(totalExpenses),
      cumulativeSaved: fromPaise(totalIncome - totalExpenses)
    }
  };
}

function groupByMonth(db, table, userId) {
  const rows = db
    .prepare(`SELECT substr(date, 1, 7) AS month, SUM(amount_paise) AS total FROM ${table} WHERE user_id = ? GROUP BY month`)
    .all(userId);
  return Object.fromEntries(rows.map((r) => [r.month, r.total]));
}

function loadSavings(db, userId, currentMonth) {
  const targetRows = db.prepare("SELECT month, target_paise FROM savings_targets WHERE user_id = ?").all(userId);
  const transferRows = db
    .prepare("SELECT id, amount_paise, date, note, created_at FROM savings_transfers WHERE user_id = ? ORDER BY date DESC, created_at DESC, rowid DESC")
    .all(userId);

  const transfers = transferRows.map((r) => ({
    id: r.id, amountPaise: r.amount_paise, amount: fromPaise(r.amount_paise), date: r.date, note: r.note
  }));

  const result = buildSavings({
    incomeByMonth: groupByMonth(db, "incomes", userId),
    expenseByMonth: groupByMonth(db, "expenses", userId),
    targetByMonth: Object.fromEntries(targetRows.map((r) => [r.month, r.target_paise])),
    transfers,
    currentMonth,
    allocatedPaise: db.prepare("SELECT COALESCE(SUM(allocated_paise), 0) AS t FROM goals WHERE user_id = ?").get(userId).t
  });

  result.transfers = transfers.map(({ amountPaise, ...rest }) => rest);
  return result;
}

// Spendable balance outside the savings wallet, in paise.
function availablePaise(db, userId) {
  const one = (sql) => db.prepare(sql).get(userId).total || 0;
  return (
    one("SELECT SUM(amount_paise) AS total FROM incomes WHERE user_id = ?") -
    one("SELECT SUM(amount_paise) AS total FROM expenses WHERE user_id = ?") -
    one("SELECT SUM(amount_paise) AS total FROM savings_transfers WHERE user_id = ?")
  );
}

module.exports = { buildSavings, goalStatus, loadSavings, availablePaise, nextMonth, monthOf };
