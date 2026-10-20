const { v4: uuidv4 } = require('uuid');
const {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} = require('@aws-sdk/lib-dynamodb');
const dynamodbService = require('../services/dynamodbService');

class DynamoDbRepository {
  constructor(customDocClient = null, tableName = null) {
    this.customDocClient = customDocClient;
    this.customTableName = tableName;
  }

  get docClient() {
    return this.customDocClient || dynamodbService.getDocClient();
  }

  get tableName() {
    return this.customTableName || dynamodbService.tableName;
  }

  // ==========================================
  // USERS
  // ==========================================

  async createUser({ id, email, passwordHash, name, defaultMonthlyIncome = 0 }) {
    const userId = id || uuidv4();
    const now = new Date().toISOString();
    const cleanEmail = email.toLowerCase().trim();

    const item = {
      PK: `USER#${userId}`,
      SK: 'PROFILE',
      GSI1PK: `USER_EMAIL#${cleanEmail}`,
      GSI1SK: 'PROFILE',
      id: userId,
      email: cleanEmail,
      password_hash: passwordHash,
      name: name.trim(),
      default_monthly_income: Number(defaultMonthlyIncome),
      created_at: now,
      updated_at: now
    };

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)'
    }));

    return this.getUserById(userId);
  }

  async getUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();

    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :email AND GSI1SK = :profile',
      ExpressionAttributeValues: {
        ':email': `USER_EMAIL#${cleanEmail}`,
        ':profile': 'PROFILE'
      }
    });

    const res = await this.docClient.send(command);
    if (!res.Items || res.Items.length === 0) return null;
    return res.Items[0];
  }

  async getUserById(id) {
    if (!id) return null;

    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${id}`,
        SK: 'PROFILE'
      }
    });

    const res = await this.docClient.send(command);
    if (!res.Item) return null;
    const { password_hash, ...user } = res.Item;
    return user;
  }

  async updateUserProfile(id, { name, defaultMonthlyIncome }) {
    const now = new Date().toISOString();
    const updates = ['updated_at = :now'];
    const values = { ':now': now };

    if (name !== undefined) {
      updates.push('name = :name');
      values[':name'] = name.trim();
    }
    if (defaultMonthlyIncome !== undefined) {
      updates.push('default_monthly_income = :income');
      values[':income'] = Number(defaultMonthlyIncome);
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${id}`,
        SK: 'PROFILE'
      },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW'
    });

    const res = await this.docClient.send(command);
    const { password_hash, ...user } = res.Attributes;
    return user;
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

    const item = {
      PK: `USER#${userId}`,
      SK: `TX#${date}#${txId}`,
      GSI1PK: `USER#${userId}#CAT#${category.trim()}`,
      GSI1SK: date,
      id: txId,
      user_id: userId,
      type,
      amount: Number(amount),
      category: category.trim(),
      description: description.trim(),
      date,
      payment_method: paymentMethod,
      receipt_url: receiptUrl,
      receipt_filename: receiptFilename,
      created_at: now,
      updated_at: now
    };

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item
    }));

    return item;
  }

  async getTransactionById(id, userId) {
    // Query user transactions and find matching ID
    const transactions = await this.getAllTransactionsForUser(userId);
    return transactions.find(t => t.id === id) || null;
  }

  async getAllTransactionsForUser(userId) {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'TX#'
      },
      ScanIndexForward: false // newest first by date
    });

    const res = await this.docClient.send(command);
    return res.Items || [];
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
    let items = await this.getAllTransactionsForUser(userId);

    // Apply filters
    if (type) items = items.filter(t => t.type === type);
    if (category) items = items.filter(t => t.category.toLowerCase() === category.toLowerCase());
    if (startDate) items = items.filter(t => t.date >= startDate);
    if (endDate) items = items.filter(t => t.date <= endDate);
    if (paymentMethod) items = items.filter(t => t.payment_method === paymentMethod);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(t =>
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q))
      );
    }

    // Sort
    const isAsc = sortOrder && sortOrder.toUpperCase() === 'ASC';
    items.sort((a, b) => {
      let va = a[sortBy] || a.date;
      let vb = b[sortBy] || b.date;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return isAsc ? -1 : 1;
      if (va > vb) return isAsc ? 1 : -1;
      return 0;
    });

    const total = items.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = items.slice(startIndex, startIndex + limitNum);

    return {
      data: paginated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    };
  }

  async updateTransaction(id, userId, updates) {
    const existing = await this.getTransactionById(id, userId);
    if (!existing) return null;

    // If date changed, sort key changes in DynamoDB, so delete old and put new
    const newDate = updates.date || existing.date;
    const oldSK = existing.SK;
    const newSK = `TX#${newDate}#${id}`;
    const now = new Date().toISOString();

    const updatedItem = {
      ...existing,
      ...updates,
      SK: newSK,
      GSI1PK: `USER#${userId}#CAT#${(updates.category || existing.category).trim()}`,
      GSI1SK: newDate,
      updated_at: now
    };

    if (oldSK !== newSK) {
      await this.docClient.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: oldSK }
      }));
    }

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: updatedItem
    }));

    return updatedItem;
  }

  async deleteTransaction(id, userId) {
    const existing = await this.getTransactionById(id, userId);
    if (!existing) return false;

    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${userId}`,
        SK: existing.SK
      }
    }));
    return true;
  }

  async getTransactionsByMultipleDates(userId, dates = []) {
    if (!dates || dates.length === 0) return [];
    const dateSet = new Set(dates);
    const all = await this.getAllTransactionsForUser(userId);
    return all.filter(t => dateSet.has(t.date));
  }

  // ==========================================
  // DASHBOARD & ANALYTICS
  // ==========================================

  async getMonthlySummary(userId, year, month) {
    const mStr = String(month).padStart(2, '0');
    const prefix = `${year}-${mStr}`;
    const all = await this.getAllTransactionsForUser(userId);

    let totalIncome = 0;
    let totalExpense = 0;
    let transactionCount = 0;
    let allTimeIncome = 0;
    let allTimeExpense = 0;

    for (const t of all) {
      if (t.type === 'income') allTimeIncome += t.amount;
      if (t.type === 'expense') allTimeExpense += t.amount;

      if (t.date.startsWith(prefix)) {
        if (t.type === 'income') totalIncome += t.amount;
        if (t.type === 'expense') totalExpense += t.amount;
        transactionCount++;
      }
    }

    // Fetch user profile for default monthly income if set
    const user = await this.getUserById(userId);
    const defaultIncome = user ? (Number(user.default_monthly_income) || 0) : 0;

    if (totalIncome === 0 && defaultIncome > 0) {
      totalIncome = defaultIncome;
    }

    if (allTimeIncome === 0 && defaultIncome > 0) {
      allTimeIncome = defaultIncome;
    }

    const availableBalance = allTimeIncome - allTimeExpense;
    const netSavings = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Number(((netSavings / totalIncome) * 100).toFixed(1)) : 0;

    const budgets = await this.getBudgets(userId);
    const totalBudget = budgets.reduce((acc, b) => acc + (b.monthly_limit || 0), 0);

    const plannedBudgetHeadroom = totalBudget > 0
      ? Math.max(0, totalBudget - totalExpense)
      : Math.max(0, totalIncome - totalExpense);

    let budgetRemaining = 0;
    let budgetCappedByCash = false;

    if (availableBalance <= 0) {
      budgetRemaining = 0;
      budgetCappedByCash = plannedBudgetHeadroom > 0;
    } else if (totalBudget > 0) {
      budgetRemaining = Math.max(0, Math.min(plannedBudgetHeadroom, availableBalance));
      budgetCappedByCash = availableBalance < plannedBudgetHeadroom;
    } else {
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
      totalBudget,
      budgetRemaining,
      plannedBudgetHeadroom,
      budgetCappedByCash,
      transactionCount
    };
  }

  async getCategoryBreakdown(userId, startDate, endDate, type = 'expense') {
    let items = await this.getAllTransactionsForUser(userId);
    items = items.filter(t => t.type === type);
    if (startDate) items = items.filter(t => t.date >= startDate);
    if (endDate) items = items.filter(t => t.date <= endDate);

    const map = new Map();
    let grandTotal = 0;

    for (const t of items) {
      const cat = t.category || 'Uncategorized';
      const cur = map.get(cat) || { total: 0, count: 0 };
      cur.total += t.amount;
      cur.count += 1;
      map.set(cat, cur);
      grandTotal += t.amount;
    }

    return Array.from(map.entries())
      .map(([category, { total, count }]) => ({
        category,
        total,
        count,
        percentage: grandTotal > 0 ? Number(((total / grandTotal) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.total - a.total);
  }

  async getSpendingTrends(userId, months = 6) {
    const all = await this.getAllTransactionsForUser(userId);
    const result = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const prefix = `${y}-${m}`;

      let income = 0;
      let expense = 0;

      for (const t of all) {
        if (t.date.startsWith(prefix)) {
          if (t.type === 'income') income += t.amount;
          if (t.type === 'expense') expense += t.amount;
        }
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

    const all = await this.getAllTransactionsForUser(userId);

    return quarters.map(q => {
      let income = 0;
      let expense = 0;
      for (const t of all) {
        if (t.date.startsWith(String(year))) {
          const m = t.date.substring(5, 7);
          if (q.months.includes(m)) {
            if (t.type === 'income') income += t.amount;
            if (t.type === 'expense') expense += t.amount;
          }
        }
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
    const all = await this.getAllTransactionsForUser(userId);

    const map = new Map();
    for (const t of all) {
      if (t.date.startsWith(prefix)) {
        const cur = map.get(t.date) || { date: t.date, expense: 0, income: 0, count: 0 };
        if (t.type === 'expense') cur.expense += t.amount;
        if (t.type === 'income') cur.income += t.amount;
        cur.count++;
        map.set(t.date, cur);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // ==========================================
  // BUDGETS & WALLET
  // ==========================================

  async getBudgets(userId) {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'BUDGET#'
      }
    });

    const res = await this.docClient.send(command);
    return (res.Items || []).sort((a, b) => a.category.localeCompare(b.category));
  }

  async getBudgetByCategory(userId, category) {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${userId}`,
        SK: `BUDGET#${category.trim()}`
      }
    });

    const res = await this.docClient.send(command);
    return res.Item || null;
  }

  async setBudget(userId, category, monthlyLimit) {
    const cleanCat = category.trim();
    const existing = await this.getBudgetByCategory(userId, cleanCat);
    const now = new Date().toISOString();

    const item = {
      PK: `USER#${userId}`,
      SK: `BUDGET#${cleanCat}`,
      id: existing ? existing.id : uuidv4(),
      user_id: userId,
      category: cleanCat,
      monthly_limit: Number(monthlyLimit),
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item
    }));

    return item;
  }

  async deleteBudget(userId, category) {
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${userId}`,
        SK: `BUDGET#${category.trim()}`
      }
    }));
    return true;
  }

  async getBudgetStatus(userId, year, month) {
    const mStr = String(month).padStart(2, '0');
    const prefix = `${year}-${mStr}`;
    const budgets = await this.getBudgets(userId);
    const all = await this.getAllTransactionsForUser(userId);

    const expenseMap = new Map();
    for (const t of all) {
      if (t.type === 'expense' && t.date.startsWith(prefix)) {
        const cat = t.category || 'Uncategorized';
        expenseMap.set(cat, (expenseMap.get(cat) || 0) + t.amount);
      }
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
    const item = {
      PK: `USER#${userId}`,
      SK: `NOTIF#${now}#${id}`,
      id,
      user_id: userId,
      type,
      title,
      message,
      read: 0,
      created_at: now
    };

    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item
    }));

    return item;
  }

  async getNotifications(userId, limit = 20) {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'NOTIF#'
      },
      ScanIndexForward: false,
      Limit: Number(limit)
    });

    const res = await this.docClient.send(command);
    return res.Items || [];
  }

  async markNotificationRead(id, userId) {
    // Read notifications for user to find SK
    const notifs = await this.getNotifications(userId, 50);
    const target = notifs.find(n => n.id === id);
    if (!target) return false;

    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: {
        PK: `USER#${userId}`,
        SK: target.SK
      },
      UpdateExpression: 'SET #read = :readVal',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: { ':readVal': 1 }
    }));
    return true;
  }

  async markAllNotificationsRead(userId) {
    const notifs = await this.getNotifications(userId, 100);
    for (const n of notifs) {
      if (!n.read) {
        await this.markNotificationRead(n.id, userId);
      }
    }
    return true;
  }
}

module.exports = DynamoDbRepository;
