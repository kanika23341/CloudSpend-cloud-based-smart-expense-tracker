"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Money is stored as integer paise (1 rupee = 100 paise) so sums never drift.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  date         TEXT NOT NULL,
  category     TEXT NOT NULL,
  payment      TEXT NOT NULL,
  source       TEXT,
  pleasure_id  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);

CREATE TABLE IF NOT EXISTS incomes (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  date         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incomes_user_date ON incomes(user_id, date);

CREATE TABLE IF NOT EXISTS savings_targets (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  target_paise INTEGER NOT NULL CHECK (target_paise > 0),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);

-- Money moved from the spending wallet into the savings wallet.
-- Transfers are NOT expenses and do not change monthly savings.
CREATE TABLE IF NOT EXISTS savings_transfers (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  date         TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON savings_transfers(user_id, date);

-- Savings goals. allocated_paise is money taken from the savings wallet and earmarked
-- for this goal. Invariant: sum(allocated) <= sum(savings transfers).
CREATE TABLE IF NOT EXISTS goals (
  id                         TEXT PRIMARY KEY,
  user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  target_paise               INTEGER NOT NULL CHECK (target_paise > 0),
  deadline                   TEXT NOT NULL,
  monthly_contribution_paise INTEGER CHECK (monthly_contribution_paise IS NULL OR monthly_contribution_paise > 0),
  allocated_paise            INTEGER NOT NULL DEFAULT 0 CHECK (allocated_paise >= 0),
  position                   INTEGER NOT NULL,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goals_user_position ON goals(user_id, position);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_income_default_paise INTEGER,
  pleasures_json               TEXT
);
`;

// Adds columns to databases created by earlier versions.
function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(user_settings)").all().map((c) => c.name);
  if (!columns.includes("discretionary_json")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN discretionary_json TEXT");
  }
}

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb };
