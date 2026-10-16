"use strict";

const V = require("./validate");

const DEFAULT_DISCRETIONARY = ["Entertainment", "Shopping", "Subscriptions"];

function previousMonth(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * Pure calculation; every input is integer paise.
 *
 * Trend per category, compared with the previous month:
 *   new (nothing last month), up, down, same.
 * Potential saving = discretionary spend x reducePercent / 100.
 */
function buildBreakdown({ month, expenseByCategory, previousByCategory, incomeSources, discretionary, reducePercent }) {
  const names = [...new Set([...V.CATEGORIES, ...Object.keys(expenseByCategory), ...Object.keys(previousByCategory)])];
  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

  const expensesTotal = sum(expenseByCategory);
  const previousExpensesTotal = sum(previousByCategory);
  const incomeTotal = incomeSources.reduce((a, s) => a + s.amountPaise, 0);

  const categories = names
    .map((category) => {
      const amount = expenseByCategory[category] || 0;
      const previous = previousByCategory[category] || 0;
      const change = amount - previous;

      let trend = "same";
      if (previous === 0 && amount > 0) trend = "new";
      else if (change > 0) trend = "up";
      else if (change < 0) trend = "down";

      const isDiscretionary = discretionary.includes(category);

      return {
        category,
        amount: V.fromPaise(amount),
        previous: V.fromPaise(previous),
        change: V.fromPaise(change),
        changePercent: previous > 0 ? Math.round((change / previous) * 1000) / 10 : null,
        sharePercent: pct(amount, expensesTotal) ?? 0,
        trend,
        discretionary: isDiscretionary,
        potentialSaving: isDiscretionary ? V.fromPaise(Math.round((amount * reducePercent) / 100)) : 0,
        _sort: [amount, previous],
        _change: change
      };
    })
    .filter((c) => c.amount > 0 || c.previous > 0)
    .sort((a, b) => b._sort[0] - a._sort[0] || b._sort[1] - a._sort[1]);

  const increases = categories
    .filter((c) => c._change > 0)
    .sort((a, b) => b._change - a._change)
    .slice(0, 3)
    .map(({ category, change, changePercent, trend }) => ({ category, change, changePercent, trend }));

  const discretionaryTotal = names.filter((n) => discretionary.includes(n)).reduce((a, n) => a + (expenseByCategory[n] || 0), 0);
  const previousDiscretionary = names.filter((n) => discretionary.includes(n)).reduce((a, n) => a + (previousByCategory[n] || 0), 0);
  const monthlySaving = Math.round((discretionaryTotal * reducePercent) / 100);
  const net = incomeTotal - expensesTotal;

  return {
    month,
    previousMonth: previousMonth(month),
    income: {
      total: V.fromPaise(incomeTotal),
      sources: incomeSources.map((s) => ({
        name: s.name,
        amount: V.fromPaise(s.amountPaise),
        sharePercent: pct(s.amountPaise, incomeTotal) ?? 0
      }))
    },
    expenses: {
      total: V.fromPaise(expensesTotal),
      previousTotal: V.fromPaise(previousExpensesTotal),
      change: V.fromPaise(expensesTotal - previousExpensesTotal),
      changePercent: previousExpensesTotal > 0
        ? Math.round(((expensesTotal - previousExpensesTotal) / previousExpensesTotal) * 1000) / 10
        : null,
      categories: categories.map(({ _sort, _change, ...rest }) => rest)
    },
    net: V.fromPaise(net),
    savingsRatePercent: incomeTotal > 0 ? Math.round((net / incomeTotal) * 1000) / 10 : null,
    increases,
    discretionary: {
      categories: discretionary,
      total: V.fromPaise(discretionaryTotal),
      previousTotal: V.fromPaise(previousDiscretionary),
      sharePercent: pct(discretionaryTotal, expensesTotal) ?? 0,
      reducePercent,
      monthlySaving: V.fromPaise(monthlySaving),
      yearlySaving: V.fromPaise(monthlySaving * 12),
      savingsAfterReduction: V.fromPaise(net + monthlySaving)
    }
  };
}

function loadDiscretionary(db, userId) {
  const row = db.prepare("SELECT discretionary_json AS j FROM user_settings WHERE user_id = ?").get(userId);
  if (!row?.j) return DEFAULT_DISCRETIONARY;
  try {
    const list = JSON.parse(row.j);
    return Array.isArray(list) ? list.filter((c) => V.CATEGORIES.includes(c)) : DEFAULT_DISCRETIONARY;
  } catch {
    return DEFAULT_DISCRETIONARY;
  }
}

function loadBreakdown(db, userId, month, reducePercent) {
  const byCategory = (m) =>
    Object.fromEntries(
      db.prepare("SELECT category, SUM(amount_paise) AS t FROM expenses WHERE user_id = ? AND substr(date, 1, 7) = ? GROUP BY category")
        .all(userId, m).map((r) => [r.category, r.t])
    );

  const incomeSources = db
    .prepare(`SELECT MIN(description) AS name, SUM(amount_paise) AS t FROM incomes
              WHERE user_id = ? AND substr(date, 1, 7) = ? GROUP BY lower(trim(description)) ORDER BY t DESC`)
    .all(userId, month)
    .map((r) => ({ name: r.name, amountPaise: r.t }));

  return buildBreakdown({
    month,
    expenseByCategory: byCategory(month),
    previousByCategory: byCategory(previousMonth(month)),
    incomeSources,
    discretionary: loadDiscretionary(db, userId),
    reducePercent
  });
}

module.exports = { buildBreakdown, loadBreakdown, loadDiscretionary, previousMonth, DEFAULT_DISCRETIONARY };
