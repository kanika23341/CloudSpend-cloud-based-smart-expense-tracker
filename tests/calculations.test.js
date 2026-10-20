const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const SqliteRepository = require('../src/db/sqliteRepository');

describe('Financial Ledger & Budget Calculations Tests', () => {
  let db;
  let repo;
  let userId;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        default_monthly_income REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        date TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        receipt_url TEXT,
        receipt_filename TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        monthly_limit REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, category)
      );
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    repo = new SqliteRepository(db);

    const user = await repo.createUser({
      email: 'finance@cloudspend.test',
      passwordHash: 'dummy',
      name: 'Finance User',
      defaultMonthlyIncome: 5000
    });
    userId = user.id;
  });

  it('should accurately calculate monthly summary, net savings, and savings rate', async () => {
    // September transactions
    await repo.createTransaction({
      userId,
      type: 'income',
      amount: 4000,
      category: 'Salary',
      description: 'Sept Salary',
      date: '2026-09-15'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 2000,
      category: 'Rent',
      description: 'Sept Rent',
      date: '2026-09-01'
    });

    // October transactions
    await repo.createTransaction({
      userId,
      type: 'income',
      amount: 5000,
      category: 'Salary',
      description: 'Oct Salary',
      date: '2026-10-01'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 1500,
      category: 'Housing',
      description: 'Oct Rent',
      date: '2026-10-02'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 500,
      category: 'Groceries',
      description: 'Oct Groceries',
      date: '2026-10-05'
    });

    const octSummary = await repo.getMonthlySummary(userId, 2026, 10);

    // October totals: Income $5000, Expenses $2000, Net $3000, Savings rate = 60.0%
    assert.equal(octSummary.totalIncome, 5000);
    assert.equal(octSummary.totalExpense, 2000);
    assert.equal(octSummary.netSavings, 3000);
    assert.equal(octSummary.savingsRate, 60.0);

    // All-time available balance: (4000 - 2000) + (5000 - 2000) = $5000
    assert.equal(octSummary.availableBalance, 5000);
  });

  it('should evaluate budget thresholds: normal, warning (>=80%), and overspent (>=100%)', async () => {
    // Set budgets
    await repo.setBudget(userId, 'Groceries', 500);
    await repo.setBudget(userId, 'Dining', 200);
    await repo.setBudget(userId, 'Utilities', 150);

    // Groceries: $420 spent out of $500 = 84% -> isWarning: true, isOverspent: false
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 420,
      category: 'Groceries',
      description: 'Supermarket bulk',
      date: '2026-10-08'
    });

    // Dining: $250 spent out of $200 = 125% -> isOverspent: true
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 250,
      category: 'Dining',
      description: 'Steakhouse dinner',
      date: '2026-10-10'
    });

    // Utilities: $50 spent out of $150 = 33.3% -> normal
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 50,
      category: 'Utilities',
      description: 'Electric bill',
      date: '2026-10-12'
    });

    const status = await repo.getBudgetStatus(userId, 2026, 10);

    const groceries = status.categories.find(c => c.category === 'Groceries');
    assert.ok(groceries);
    assert.equal(groceries.spent, 420);
    assert.equal(groceries.percent, 84.0);
    assert.equal(groceries.isWarning, true);
    assert.equal(groceries.isOverspent, false);

    const dining = status.categories.find(c => c.category === 'Dining');
    assert.ok(dining);
    assert.equal(dining.spent, 250);
    assert.equal(dining.percent, 125.0);
    assert.equal(dining.isOverspent, true);
    assert.equal(dining.remaining, -50);

    const utilities = status.categories.find(c => c.category === 'Utilities');
    assert.ok(utilities);
    assert.equal(utilities.spent, 50);
    assert.equal(utilities.isWarning, false);
    assert.equal(utilities.isOverspent, false);

    // Total budget: 500 + 200 + 150 = 850
    // Total spent: 420 + 250 + 50 = 720
    assert.equal(status.totalBudget, 850);
    assert.equal(status.totalSpent, 720);
    assert.equal(status.totalRemaining, 130);
  });

  it('should ensure income increases balance without increasing spending, and budget remaining is capped by available cash', async () => {
    // 1. Initial state: user has zero transactions
    const initialSummary = await repo.getMonthlySummary(userId, 2026, 10);
    assert.equal(initialSummary.totalExpense, 0);

    // 2. Set high budget limit of 50000
    await repo.setBudget(userId, 'Groceries', 50000);

    // 3. Enter income of 5000
    await repo.createTransaction({
      userId,
      type: 'income',
      amount: 5000,
      category: 'Salary',
      description: 'October Salary',
      date: '2026-10-01'
    });

    const summaryAfterIncome = await repo.getMonthlySummary(userId, 2026, 10);
    // Spending must still be 0! Entering income should NEVER increase spending!
    assert.equal(summaryAfterIncome.totalExpense, 0, 'Spending must not increase when income is entered');
    assert.equal(summaryAfterIncome.totalIncome, 5000);
    assert.equal(summaryAfterIncome.availableBalance, 5000);

    // Budget limit is 50000, but available cash is only 5000.
    // Therefore, budgetRemaining MUST NOT exceed available cash!
    assert.equal(summaryAfterIncome.budgetRemaining, 5000, 'Budget remaining must never exceed available cash');
    assert.equal(summaryAfterIncome.budgetCappedByCash, true);
    assert.equal(summaryAfterIncome.plannedBudgetHeadroom, 50000);

    // 4. Record expense of 2000
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 2000,
      category: 'Groceries',
      description: 'Supermarket',
      date: '2026-10-05'
    });

    const summaryAfterExpense = await repo.getMonthlySummary(userId, 2026, 10);
    assert.equal(summaryAfterExpense.totalExpense, 2000);
    assert.equal(summaryAfterExpense.availableBalance, 3000);
    // Available cash is 3000, unspent limit is 48000. Budget remaining is 3000!
    assert.equal(summaryAfterExpense.budgetRemaining, 3000);
    assert.ok(summaryAfterExpense.budgetRemaining <= summaryAfterExpense.availableBalance);
  });
});
