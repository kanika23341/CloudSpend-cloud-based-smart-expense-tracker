const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDatabase, closeDatabase } = require('../src/db/sqlite');

async function initSqlite() {
  console.log('[SQLite:Init] Ensuring database schema is initialized...');
  const db = getDatabase();

  const isSeed = process.argv.includes('--seed');
  if (isSeed) {
    console.log('[SQLite:Seed] Seeding demo account and sample transactions...');

    // Check if demo user already exists
    const checkStmt = db.prepare('SELECT id FROM users WHERE email = ?');
    const existing = checkStmt.get('demo@cloudspend.local');

    let userId;
    if (existing) {
      userId = existing.id;
      console.log(`[SQLite:Seed] Demo user already exists (id: ${userId}). Refreshing data...`);
      db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM budgets WHERE user_id = ?').run(userId);
    } else {
      userId = uuidv4();
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('Password123!', salt);
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (id, email, password_hash, name, default_monthly_income, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'demo@cloudspend.local', hash, 'Demo User', 75000, now, now);
      console.log(`[SQLite:Seed] Created demo user demo@cloudspend.local / Password123!`);
    }

    // Insert category budgets
    const now = new Date().toISOString();
    const budgetStmt = db.prepare(`
      INSERT INTO budgets (id, user_id, category, monthly_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const defaultBudgets = [
      { category: 'Groceries', limit: 15000 },
      { category: 'Housing & Rent', limit: 25000 },
      { category: 'Dining Out', limit: 6000 },
      { category: 'Utilities', limit: 4500 },
      { category: 'Entertainment', limit: 3500 },
      { category: 'Transportation', limit: 5000 },
      { category: 'Healthcare', limit: 4000 },
      { category: 'Shopping', limit: 5000 }
    ];

    for (const b of defaultBudgets) {
      budgetStmt.run(uuidv4(), userId, b.category, b.limit, now, now);
    }

    // Insert sample transactions across the last 30 days
    const txStmt = db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, category, description, date, payment_method, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const today = new Date();
    const sampleData = [
      { daysAgo: 28, type: 'income', amount: 75000, category: 'Salary', desc: 'Monthly Salary Direct Deposit', method: 'Bank Transfer' },
      { daysAgo: 27, type: 'expense', amount: 24000, category: 'Housing & Rent', desc: 'Monthly Apartment Rent', method: 'Bank Transfer' },
      { daysAgo: 25, type: 'expense', amount: 4500, category: 'Groceries', desc: 'Weekly Supermarket Grocery Haul', method: 'Credit Card' },
      { daysAgo: 23, type: 'expense', amount: 1850, category: 'Dining Out', desc: 'Weekend Bistro Family Dinner', method: 'Credit Card' },
      { daysAgo: 20, type: 'expense', amount: 2400, category: 'Utilities', desc: 'Electricity & Piped Gas Bill', method: 'Debit Card' },
      { daysAgo: 18, type: 'expense', amount: 450, category: 'Dining Out', desc: 'Artisan Cafe Coffee & Croissant', method: 'Digital Wallet' },
      { daysAgo: 16, type: 'expense', amount: 5200, category: 'Groceries', desc: 'Monthly Bulk Pantry Essentials', method: 'Debit Card' },
      { daysAgo: 14, type: 'expense', amount: 1500, category: 'Transportation', desc: 'Metro Rail Smartcard Recharge', method: 'Debit Card' },
      { daysAgo: 12, type: 'expense', amount: 3800, category: 'Shopping', desc: 'Home Office Ergonomic Accessories', method: 'Credit Card' },
      { daysAgo: 10, type: 'expense', amount: 900, category: 'Entertainment', desc: 'Multiplex Movie Weekend Tickets', method: 'Credit Card' },
      { daysAgo: 8, type: 'expense', amount: 1800, category: 'Healthcare', desc: 'Consultation & Wellness Medicines', method: 'Credit Card' },
      { daysAgo: 6, type: 'income', amount: 12000, category: 'Freelance', desc: 'UI/UX Design Consulting Milestone', method: 'Bank Transfer' },
      { daysAgo: 5, type: 'expense', amount: 2600, category: 'Groceries', desc: 'Fresh Farm Fruits & Veg Haul', method: 'Credit Card' },
      { daysAgo: 4, type: 'expense', amount: 1400, category: 'Dining Out', desc: 'Team Noodle Bowl Lunch', method: 'Digital Wallet' },
      { daysAgo: 3, type: 'expense', amount: 1200, category: 'Utilities', desc: 'High-Speed Fiber Broadband Bill', method: 'Debit Card' },
      { daysAgo: 1, type: 'expense', amount: 650, category: 'Transportation', desc: 'City Ride Cab to Client Office', method: 'Digital Wallet' },
      { daysAgo: 0, type: 'expense', amount: 350, category: 'Dining Out', desc: 'Snack Sandwich & Green Tea', method: 'Digital Wallet' }
    ];

    for (const item of sampleData) {
      const d = new Date();
      d.setDate(today.getDate() - item.daysAgo);
      const dateStr = d.toISOString().split('T')[0];
      txStmt.run(uuidv4(), userId, item.type, item.amount, item.category, item.desc, dateStr, item.method, now, now);
    }

    console.log(`[SQLite:Seed] Successfully seeded ${sampleData.length} transactions and ${defaultBudgets.length} budgets.`);
  }

  closeDatabase();
  console.log('[SQLite:Init] Done.');
}

if (require.main === module) {
  initSqlite().catch(err => {
    console.error('[SQLite:Init] Failed:', err);
    process.exit(1);
  });
}

module.exports = { initSqlite };
