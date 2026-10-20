const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let dbInstance = null;

function getDatabase(customPath) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || config.storage.sqlitePath;

  // Ensure directory exists if not an in-memory db
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and foreign keys for relational integrity
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  initializeSchema(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      default_monthly_income REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
      amount REAL NOT NULL CHECK(amount > 0),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      receipt_url TEXT,
      receipt_filename TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      monthly_limit REAL NOT NULL CHECK(monthly_limit >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, category)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_cat ON transactions(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
  `);
}

function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  getDatabase,
  closeDatabase
};
