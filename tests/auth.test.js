const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const SqliteRepository = require('../src/db/sqliteRepository');
const config = require('../src/config');

describe('Authentication & User Isolation Tests', () => {
  let db;
  let repo;

  beforeEach(() => {
    // Isolated in-memory database for testing
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
  });

  it('should hash passwords securely and verify them accurately', async () => {
    const rawPassword = 'SecurePassword2026!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(rawPassword, salt);

    assert.notEqual(hash, rawPassword);
    const match = await bcrypt.compare(rawPassword, hash);
    assert.equal(match, true);

    const wrongMatch = await bcrypt.compare('WrongPassword', hash);
    assert.equal(wrongMatch, false);
  });

  it('should sign and verify valid JWT tokens', () => {
    const payload = { userId: 'user-123', email: 'test@example.com' };
    const token = jwt.sign(payload, config.auth.jwtSecret, { expiresIn: '1h' });

    const decoded = jwt.verify(token, config.auth.jwtSecret);
    assert.equal(decoded.userId, 'user-123');
    assert.equal(decoded.email, 'test@example.com');
  });

  it('should reject tampered or invalid JWT tokens', () => {
    const token = jwt.sign({ userId: 'user-123' }, config.auth.jwtSecret);
    assert.throws(() => {
      jwt.verify(token, 'different-secret-key-that-does-not-match');
    });
  });

  it('should strictly isolate data between distinct users', async () => {
    // Create User A and User B
    const userA = await repo.createUser({
      email: 'userA@test.com',
      passwordHash: 'hashA',
      name: 'User Alpha',
      defaultMonthlyIncome: 3000
    });

    const userB = await repo.createUser({
      email: 'userB@test.com',
      passwordHash: 'hashB',
      name: 'User Beta',
      defaultMonthlyIncome: 5000
    });

    // Create transactions for User A
    const txA = await repo.createTransaction({
      userId: userA.id,
      type: 'expense',
      amount: 150,
      category: 'Groceries',
      description: 'Alpha Groceries',
      date: '2026-10-15'
    });

    // Create transactions for User B
    const txB = await repo.createTransaction({
      userId: userB.id,
      type: 'expense',
      amount: 400,
      category: 'Electronics',
      description: 'Beta Headphones',
      date: '2026-10-16'
    });

    // Verify User A cannot access User B's transaction
    const userAfetchesB = await repo.getTransactionById(txB.id, userA.id);
    assert.equal(userAfetchesB, null, 'User A should never see User B transaction');

    // Verify User B cannot access User A's transaction
    const userBfetchesA = await repo.getTransactionById(txA.id, userB.id);
    assert.equal(userBfetchesA, null, 'User B should never see User A transaction');

    // Verify listing transactions is isolated
    const listA = await repo.listTransactions(userA.id);
    assert.equal(listA.data.length, 1);
    assert.equal(listA.data[0].id, txA.id);

    const listB = await repo.listTransactions(userB.id);
    assert.equal(listB.data.length, 1);
    assert.equal(listB.data[0].id, txB.id);

    // Verify User A cannot delete User B's transaction
    const deleted = await repo.deleteTransaction(txB.id, userA.id);
    assert.equal(deleted, false, 'User A should not be able to delete User B transaction');

    // Confirm User B transaction still exists
    const stillExists = await repo.getTransactionById(txB.id, userB.id);
    assert.notEqual(stillExists, null);
  });
});
