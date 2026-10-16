"use strict";

const { fromPaise } = require("./validate");

const monthIndex = (value) => {
  const [y, m] = value.split("-").map(Number);
  return y * 12 + (m - 1);
};

const monthKeyFromIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/**
 * Status of one goal. All money is integer paise.
 *
 *   completed  allocated >= target
 *   overdue    deadline has passed and the goal is not funded
 *   on_track   planned monthly contribution x months left >= remaining
 *   behind     a monthly contribution is planned but too small (or the deadline is this month)
 *   no_plan    no monthly contribution set
 *
 * One contribution is assumed per month, starting next month, so the number of
 * contributions available before the deadline is the number of months left.
 */
function evaluateGoal({ targetPaise, allocatedPaise, deadline, monthlyPaise, today }) {
  const remaining = Math.max(0, targetPaise - allocatedPaise);
  const monthsLeft = Math.max(0, monthIndex(deadline) - monthIndex(today));

  if (remaining === 0) {
    return { status: "completed", remaining, monthsLeft, requiredPaise: 0, projectedMonth: null };
  }

  const requiredPaise = Math.ceil(remaining / Math.max(1, monthsLeft));
  const projectedMonth = monthlyPaise
    ? monthKeyFromIndex(monthIndex(today) + Math.ceil(remaining / monthlyPaise))
    : null;

  let status;
  if (deadline < today) status = "overdue";
  else if (!monthlyPaise) status = "no_plan";
  else if (monthsLeft >= 1 && monthlyPaise * monthsLeft >= remaining) status = "on_track";
  else status = "behind";

  return { status, remaining, monthsLeft, requiredPaise, projectedMonth };
}

function goalRows(db, userId) {
  return db.prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY position, rowid").all(userId);
}

function walletPaise(db, userId) {
  return db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS t FROM savings_transfers WHERE user_id = ?").get(userId).t;
}

function allocatedPaise(db, userId) {
  return db.prepare("SELECT COALESCE(SUM(allocated_paise), 0) AS t FROM goals WHERE user_id = ?").get(userId).t;
}

// Savings-wallet money not yet earmarked for a goal.
function unallocatedPaise(db, userId) {
  return walletPaise(db, userId) - allocatedPaise(db, userId);
}

function presentGoal(row, index, today) {
  const info = evaluateGoal({
    targetPaise: row.target_paise,
    allocatedPaise: row.allocated_paise,
    deadline: row.deadline,
    monthlyPaise: row.monthly_contribution_paise,
    today
  });

  return {
    id: row.id,
    name: row.name,
    priority: index + 1,
    target: fromPaise(row.target_paise),
    allocated: fromPaise(row.allocated_paise),
    remaining: fromPaise(info.remaining),
    progressPercent: Math.min(100, Math.round((row.allocated_paise / row.target_paise) * 1000) / 10),
    deadline: row.deadline,
    monthlyContribution: row.monthly_contribution_paise ? fromPaise(row.monthly_contribution_paise) : null,
    status: info.status,
    monthsLeft: info.monthsLeft,
    requiredPerMonth: fromPaise(info.requiredPaise),
    projectedCompletion: info.projectedMonth
  };
}

function loadGoals(db, userId, today) {
  const rows = goalRows(db, userId);
  const wallet = walletPaise(db, userId);
  const allocated = rows.reduce((sum, r) => sum + r.allocated_paise, 0);

  return {
    goals: rows.map((row, i) => presentGoal(row, i, today)),
    // Allocating moves money out of the wallet and into a goal.
    pool: {
      walletBalance: fromPaise(wallet - allocated), // still in the savings wallet
      allocated: fromPaise(allocated),              // held in goals
      totalSaved: fromPaise(wallet)                 // everything transferred into savings
    }
  };
}

/**
 * Fill goals in priority order until the money left in the savings wallet runs out.
 * Returns the paise handed to each goal.
 */
function autoAllocate(db, userId) {
  let pool = unallocatedPaise(db, userId);
  const given = [];

  for (const goal of goalRows(db, userId)) {
    if (pool <= 0) break;
    const need = goal.target_paise - goal.allocated_paise;
    if (need <= 0) continue;

    const amount = Math.min(need, pool);
    db.prepare("UPDATE goals SET allocated_paise = allocated_paise + ? WHERE id = ? AND user_id = ?").run(amount, goal.id, userId);
    pool -= amount;
    given.push({ goalId: goal.id, name: goal.name, amountPaise: amount });
  }

  return given;
}

module.exports = {
  evaluateGoal, goalRows, walletPaise, allocatedPaise, unallocatedPaise,
  presentGoal, loadGoals, autoAllocate
};
