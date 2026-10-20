const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('./sqlite');

class SqliteRepository {
  constructor(customDb = null) {
    this.customDb = customDb;
  }

  get db() {
    return this.customDb || getDatabase();
  }

  // ==========================================
  // USERS
  // ==========================================

  async createUser({ id, email, passwordHash, name, defaultMonthlyIncome = 0 }) {
    const userId = id || uuidv4();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, name, default_monthly_income, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, email.toLowerCase().trim(), passwordHash, name.trim(), defaultMonthlyIncome, now, now);
    return this.getUserById(userId);
  }

  async getUserByEmail(email) {
    if (!email) return null;
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const user = stmt.get(email.toLowerCase().trim());
    return user || null;
  }

  async getUserById(id) {
    if (!id) return null;
    const stmt = this.db.prepare('SELECT id, email, name, default_monthly_income, created_at, updated_at FROM users WHERE id = ?');
    const user = stmt.get(id);
    return user || null;
  }

  async updateUserProfile(id, { name, defaultMonthlyIncome }) {
    const now = new Date().toISOString();
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (defaultMonthlyIncome !== undefined) {
      updates.push('default_monthly_income = ?');
      params.push(Number(defaultMonthlyIncome));
    }

    if (updates.length === 0) return this.getUserById(id);

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    const stmt = this.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...params);
    return this.getUserById(id);
  }

  // ==========================================
  // TRANSACTIONS
  // ==========================================

  async createTransaction({
    id,
    userId,
    type,
    amount,
    category,
    description,
    date,
    paymentMethod = 'Debit Card',
    receiptUrl = null,
    receiptFilename = null
  }) {
    const txId = id || uuidv4();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, category, description, date, payment_method, receipt_url, receipt_filename, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      txId,
      userId,
      type,
      Number(amount),
      category.trim(),
      description.trim(),
      date,
      paymentMethod,
      receiptUrl,
      receiptFilename,
      now,
      now
    );
    return this.getTransactionById(txId, userId);
  }

  async getTransactionById(id, userId) {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?');
    return stmt.get(id, userId) || null;
  }

  async listTransactions(userId, {
    type,
    category,
    startDate,
    endDate,
    paymentMethod,
    search,
    page = 1,
    limit = 20,
    sortBy = 'date',
    sortOrder = 'DESC'
  } = {}) {
    const whereClauses = ['user_id = ?'];
    const params = [userId];

    if (type && (type === 'expense' || type === 'income')) {
      whereClauses.push('type = ?');
      params.push(type);
    }
    if (category) {
      whereClauses.push('category = ?');
      params.push(category);
    }
    if (startDate) {
      whereClauses.push('date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push('date <= ?');
      params.push(endDate);
    }
    if (paymentMethod) {
      whereClauses.push('payment_method = ?');
      params.push(paymentMethod);
    }
    if (search) {
      whereClauses.push('(description LIKE ? OR category LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.join(' AND ');

    // Total count query
    const countStmt = this.db.prepare(`SELECT COUNT(*) AS total FROM transactions WHERE ${whereSql}`);
    const { total } = countStmt.get(...params);

    // Validation for sorting
    const validSortCols = {
      date: 'date',
      amount: 'amount',
      description: 'description',
      category: 'category',
      created_at: 'created_at'
    };
    const sortCol = validSortCols[sortBy] || 'date';
    const sortDir = (sortOrder && sortOrder.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

    const offset = Math.max(0, (Number(page) - 1) * Number(limit));
    const dataStmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}, created_at DESC
      LIMIT ? OFFSET ?
    `);

    const data = dataStmt.all(...params, Number(limit), offset);

    return {
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    };
  }

  async updateTransaction(id, userId, {
    type,
    amount,
    category,
    description,
    date,
    paymentMethod,
    receiptUrl,
    receiptFilename
  }) {
    const existing = await this.getTransactionById(id, userId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE transactions
      SET type = ?, amount = ?, category = ?, description = ?, date = ?, payment_method = ?, receipt_url = ?, receipt_filename = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      type !== undefined ? type : existing.type,
      amount !== undefined ? Number(amount) : existing.amount,
      category !== undefined ? category.trim() : existing.category,
      description !== undefined ? description.trim() : existing.description,
      date !== undefined ? date : existing.date,
      paymentMethod !== undefined ? paymentMethod : existing.payment_method,
      receiptUrl !== undefined ? receiptUrl : existing.receipt_url,
      receiptFilename !== undefined ? receiptFilename : existing.receipt_filename,
      now,
      id,
      userId
    );

    return this.getTransactionById(id, userId);
  }

  async deleteTransaction(id, userId) {
    const stmt = this.db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');
    const result = stmt.run(id, userId);
    return result.changes > 0;
  }

  async getTransactionsByMultipleDates(userId, dates = []) {
    if (!dates || dates.length === 0) return [];
    const placeholders = dates.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE user_id = ? AND date IN (${placeholders})
      ORDER BY date DESC, created_at DESC
    `);
    return stmt.all(userId, ...dates);
  }

  // ==========================================
  // DASHBOARD & ANALYTICS
  // ==========================================

  async getMonthlySummary(userId, year, month) {
    // month is 1-12 or string '01'-'12'
    const mStr = String(month).padStart(2, '0');
    const prefix = `${year}-${mStr}`;

    const stmt = this.db.prepare(`
      SELECT
        type,
        COALESCE(SUM(amount), 0) AS total,
        COUNT(*) AS count
      FROM transactions
      WHERE user_id = ? AND date LIKE ?
      GROUP BY type
    `);

    const rows = stmt.all(userId, `${prefix}%`);
    let totalIncome = 0;
    let totalExpense = 0;
    let transactionCount = 0;

    for (const row of rows) {
      if (row.type === 'income') totalIncome = row.total;
      if (row.type === 'expense') totalExpense = row.total;
      transactionCount += row.count;
    }

    // Fetch user profile for default monthly income if set
    const userStmt = this.db.prepare('SELECT default_monthly_income FROM users WHERE id = ?');
    const userRow = userStmt.get(userId);
    const defaultIncome = userRow ? (Number(userRow.default_monthly_income) || 0) : 0;

    // If user has not logged explicit income transactions this month, but configured default income:
    if (totalIncome === 0 && defaultIncome > 0) {
      totalIncome = defaultIncome;
    }

    // Also get all-time balance
    const allTimeStmt = this.db.prepare(`
      SELECT
        LOWER(TRIM(type)) AS type,
        COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE user_id = ?
      GROUP BY LOWER(TRIM(type))
    `);
    const allTimeRows = allTimeStmt.all(userId);
    let allTimeIncome = 0;
    let allTimeExpense = 0;
    for (const r of allTimeRows) {
      if (r.type === 'income') allTimeIncome = r.total;
      if (r.type === 'expense') allTimeExpense = r.total;
    }

    if (allTimeIncome === 0 && defaultIncome > 0) {
      allTimeIncome = defaultIncome;
    }

    const availableBalance = allTimeIncome - allTimeExpense;
    const netSavings = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Number(((netSavings / totalIncome) * 100).toFixed(1)) : 0;

    // Get total budget for this month
    const budgetStmt = this.db.prepare(`
      SELECT COALESCE(SUM(monthly_limit), 0) AS totalBudget
      FROM budgets
      WHERE user_id = ?
    `);
    const { totalBudget } = budgetStmt.get(userId);
    const budgetTotal = Number(totalBudget) || 0;

    // Logical Budget Remaining Constraint:
    // A user's remaining spendable budget CANNOT exceed their available cash on hand.
    const plannedBudgetHeadroom = budgetTotal > 0
      ? Math.max(0, budgetTotal - totalExpense)
      : Math.max(0, totalIncome - totalExpense);

    let budgetRemaining = 0;
    let budgetCappedByCash = false;

    if (availableBalance <= 0) {
      // Overdrawn or zero cash: no remaining budget can be spent safely
      budgetRemaining = 0;
      budgetCappedByCash = plannedBudgetHeadroom > 0;
    } else if (budgetTotal > 0) {
      // Bounded by both planned budget headroom AND actual available cash
      budgetRemaining = Math.max(0, Math.min(plannedBudgetHeadroom, availableBalance));
      budgetCappedByCash = availableBalance < plannedBudgetHeadroom;
    } else {
      // If no category limits set, remaining budget is unspent cash this month
      budgetRemaining = Math.max(0, Math.min(totalIncome - totalExpense, availableBalance));
      budgetCappedByCash = availableBalance < (totalIncome - totalExpense);
    }

    return {
      year: Number(year),
      month: Number(month),
      monthFormatted: prefix,
      totalIncome,
      totalExpense,
      netSavings,
      savingsRate,
      availableBalance,
      totalBudget: budgetTotal,
      budgetRemaining,
      plannedBudgetHeadroom,
      budgetCappedByCash,
      transactionCount
    };
  }

  async getCategoryBreakdown(userId, startDate, endDate, type = 'expense') {
    let query = `
      SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM transactions
      WHERE user_id = ? AND type = ?
    `;
    const params = [userId, type];

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY category ORDER BY total DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

    return rows.map(r => ({
      category: r.category,
      total: r.total,
      count: r.count,
      percentage: grandTotal > 0 ? Number(((r.total / grandTotal) * 100).toFixed(1)) : 0
    }));
  }

  async getSpendingTrends(userId, months = 6) {
    // Generate array of past N months: YYYY-MM
    const result = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const prefix = `${y}-${m}`;

      const stmt = this.db.prepare(`
        SELECT type, COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE user_id = ? AND date LIKE ?
        GROUP BY type
      `);
      const rows = stmt.all(userId, `${prefix}%`);
      let income = 0;
      let expense = 0;
      for (const r of rows) {
        if (r.type === 'income') income = r.total;
        if (r.type === 'expense') expense = r.total;
      }

      result.push({
        month: prefix,
        label: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        income,
        expense,
        net: income - expense
      });
    }

    return result;
  }

  async getQuarterlyComparison(userId, year) {
    const quarters = [
      { quarter: 'Q1', months: ['01', '02', '03'] },
      { quarter: 'Q2', months: ['04', '05', '06'] },
      { quarter: 'Q3', months: ['07', '08', '09'] },
      { quarter: 'Q4', months: ['10', '11', '12'] }
    ];

    return quarters.map(q => {
      const prefixes = q.months.map(m => `'${year}-${m}%'`).join(' OR date LIKE ');
      const stmt = this.db.prepare(`
        SELECT type, COALESCE(SUM(amount), 0) as total
        FROM transactions
        WHERE user_id = ? AND (date LIKE ${prefixes})
        GROUP BY type
      `);
      const rows = stmt.all(userId);
      let income = 0;
      let expense = 0;
      for (const r of rows) {
        if (r.type === 'income') income = r.total;
        if (r.type === 'expense') expense = r.total;
      }
      return {
        quarter: q.quarter,
        year: Number(year),
        income,
        expense,
        net: income - expense
      };
    });
  }

  async getDailySpending(userId, year, month) {
    const mStr = String(month).padStart(2, '0');
    const prefix = `${year}-${mStr}`;

    const stmt = this.db.prepare(`
      SELECT
        date,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
        COUNT(*) AS count
      FROM transactions
      WHERE user_id = ? AND date LIKE ?
      GROUP BY date
      ORDER BY date ASC
    `);

    return stmt.all(userId, `${prefix}%`);
  }

  // ==========================================
  // BUDGETS & WALLET
  // ==========================================

  async getBudgets(userId) {
    const stmt = this.db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY category ASC');
    return stmt.all(userId);
  }

  async getBudgetByCategory(userId, category) {
    const stmt = this.db.prepare('SELECT * FROM budgets WHERE user_id = ? AND category = ?');
    return stmt.get(userId, category.trim()) || null;
  }

  async setBudget(userId, category, monthlyLimit) {
    const existing = await this.getBudgetByCategory(userId, category);
    const now = new Date().toISOString();

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE budgets
        SET monthly_limit = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `);
      stmt.run(Number(monthlyLimit), now, existing.id, userId);
      return this.getBudgetByCategory(userId, category);
    } else {
      const id = uuidv4();
      const stmt = this.db.prepare(`
        INSERT INTO budgets (id, user_id, category, monthly_limit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, userId, category.trim(), Number(monthlyLimit), now, now);
      return this.getBudgetByCategory(userId, category);
    }
  }

  async deleteBudget(userId, category) {
    const stmt = this.db.prepare('DELETE FROM budgets WHERE user_id = ? AND category = ?');
    const result = stmt.run(userId, category.trim());
    return result.changes > 0;
  }

  async getBudgetStatus(userId, year, month) {
    const mStr = String(month).padStart(2, '0');
    const prefix = `${year}-${mStr}`;

    const budgets = await this.getBudgets(userId);

    // Get current month expense per category
    const stmt = this.db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS spent
      FROM transactions
      WHERE user_id = ? AND type = 'expense' AND date LIKE ?
      GROUP BY category
    `);
    const expenses = stmt.all(userId, `${prefix}%`);
    const expenseMap = new Map();
    for (const exp of expenses) {
      expenseMap.set(exp.category, exp.spent);
    }

    let totalBudget = 0;
    let totalSpent = 0;

    const items = budgets.map(b => {
      const spent = expenseMap.get(b.category) || 0;
      const limit = b.monthly_limit;
      const remaining = limit - spent;
      const percent = limit > 0 ? Number(((spent / limit) * 100).toFixed(1)) : 0;
      const isOverspent = spent > limit;
      const isWarning = !isOverspent && percent >= 80;

      totalBudget += limit;
      totalSpent += spent;

      return {
        id: b.id,
        category: b.category,
        limit,
        spent,
        remaining,
        percent,
        isOverspent,
        isWarning
      };
    });

    // Also include any categories that had expenses but have no budget set
    for (const [cat, spent] of expenseMap.entries()) {
      if (!budgets.some(b => b.category === cat)) {
        totalSpent += spent;
        items.push({
          id: null,
          category: cat,
          limit: 0,
          spent,
          remaining: -spent,
          percent: 100,
          isOverspent: true,
          isWarning: false,
          unbudgeted: true
        });
      }
    }

    return {
      year: Number(year),
      month: Number(month),
      totalBudget,
      totalSpent,
      totalRemaining: totalBudget - totalSpent,
      totalPercent: totalBudget > 0 ? Number(((totalSpent / totalBudget) * 100).toFixed(1)) : 0,
      categories: items
    };
  }

  // ==========================================
  // NOTIFICATIONS
  // ==========================================

  async createNotification(userId, { type = 'alert', title, message }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);
    stmt.run(id, userId, type, title, message, now);
    return { id, userId, type, title, message, read: 0, created_at: now };
  }

  async getNotifications(userId, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(userId, Number(limit));
  }

  async markNotificationRead(id, userId) {
    const stmt = this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?');
    stmt.run(id, userId);
    return true;
  }

  async markAllNotificationsRead(userId) {
    const stmt = this.db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?');
    stmt.run(userId);
    return true;
  }
}

module.exports = SqliteRepository;
