const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const SqliteRepository = require('../src/db/sqliteRepository');

describe('Transaction Repository & Filtering Tests', () => {
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
      email: 'testuser@example.com',
      passwordHash: 'dummy',
      name: 'Test User'
    });
    userId = user.id;
  });

  it('should create, retrieve, update and delete a transaction', async () => {
    // 1. Create
    const tx = await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 45.50,
      category: 'Dining Out',
      description: 'Coffee & Breakfast',
      date: '2026-10-10',
      paymentMethod: 'Credit Card'
    });

    assert.ok(tx.id);
    assert.equal(tx.amount, 45.50);
    assert.equal(tx.category, 'Dining Out');
    assert.equal(tx.payment_method, 'Credit Card');

    // 2. Retrieve
    const fetched = await repo.getTransactionById(tx.id, userId);
    assert.deepEqual(fetched, tx);

    // 3. Update
    const updated = await repo.updateTransaction(tx.id, userId, {
      amount: 52.00,
      description: 'Coffee & Breakfast & Pastry'
    });
    assert.equal(updated.amount, 52.00);
    assert.equal(updated.description, 'Coffee & Breakfast & Pastry');

    // 4. Delete
    const deleted = await repo.deleteTransaction(tx.id, userId);
    assert.equal(deleted, true);

    const missing = await repo.getTransactionById(tx.id, userId);
    assert.equal(missing, null);
  });

  it('should filter transactions by type, category, and date range', async () => {
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 100,
      category: 'Groceries',
      description: 'Whole Foods',
      date: '2026-10-01'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 50,
      category: 'Utilities',
      description: 'Water bill',
      date: '2026-10-05'
    });
    await repo.createTransaction({
      userId,
      type: 'income',
      amount: 3000,
      category: 'Salary',
      description: 'Tech Paycheck',
      date: '2026-10-10'
    });

    // Filter by type: expense
    const expenses = await repo.listTransactions(userId, { type: 'expense' });
    assert.equal(expenses.data.length, 2);

    // Filter by category: Groceries
    const groceries = await repo.listTransactions(userId, { category: 'Groceries' });
    assert.equal(groceries.data.length, 1);
    assert.equal(groceries.data[0].amount, 100);

    // Filter by date range
    const dateRange = await repo.listTransactions(userId, {
      startDate: '2026-10-02',
      endDate: '2026-10-06'
    });
    assert.equal(dateRange.data.length, 1);
    assert.equal(dateRange.data[0].description, 'Water bill');
  });

  it('should support multi-date lookup for calendar/heatmap selection', async () => {
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 25,
      category: 'Dining',
      description: 'Day 10 lunch',
      date: '2026-10-10'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 30,
      category: 'Dining',
      description: 'Day 12 dinner',
      date: '2026-10-12'
    });
    await repo.createTransaction({
      userId,
      type: 'expense',
      amount: 40,
      category: 'Dining',
      description: 'Day 15 snack',
      date: '2026-10-15'
    });

    const multi = await repo.getTransactionsByMultipleDates(userId, ['2026-10-10', '2026-10-12']);
    assert.equal(multi.length, 2);
    const amounts = multi.map(m => m.amount).sort();
    assert.deepEqual(amounts, [25, 30]);
  });
});
