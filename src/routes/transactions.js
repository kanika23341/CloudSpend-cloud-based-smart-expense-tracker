const express = require('express');
const { getRepository } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateTransaction } = require('../middleware/validate');
const cloudwatchService = require('../services/cloudwatchService');
const snsService = require('../services/snsService');

const router = express.Router();

// All transaction routes require authentication
router.use(requireAuth);

/**
 * List transactions with filtering, search, sorting, and pagination
 */
router.get('/', async (req, res) => {
  try {
    const {
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
    } = req.query;

    const repo = getRepository();
    const result = await repo.listTransactions(req.user.id, {
      type,
      category,
      startDate,
      endDate,
      paymentMethod,
      search,
      page,
      limit,
      sortBy,
      sortOrder
    });

    return res.json(result);
  } catch (err) {
    console.error('[Transactions:List] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve transactions.' });
  }
});

/**
 * Query transactions for multiple selected dates (Heatmap & Calendar multi-selection)
 */
router.post('/by-dates', async (req, res) => {
  try {
    const { dates } = req.body;
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Array of dates is required.' });
    }

    const repo = getRepository();
    const transactions = await repo.getTransactionsByMultipleDates(req.user.id, dates);

    let totalExpense = 0;
    let totalIncome = 0;

    for (const t of transactions) {
      if (t.type === 'expense') totalExpense += t.amount;
      if (t.type === 'income') totalIncome += t.amount;
    }

    return res.json({
      dates,
      count: transactions.length,
      totalExpense,
      totalIncome,
      net: totalIncome - totalExpense,
      transactions
    });
  } catch (err) {
    console.error('[Transactions:ByDates] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve transactions for selected dates.' });
  }
});

/**
 * Get single transaction by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const repo = getRepository();
    const transaction = await repo.getTransactionById(req.params.id, req.user.id);

    if (!transaction) {
      return res.status(404).json({ error: 'Not Found', message: 'Transaction not found.' });
    }

    return res.json({ transaction });
  } catch (err) {
    console.error('[Transactions:Get] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve transaction.' });
  }
});

/**
 * Create a new transaction
 */
router.post('/', validateTransaction, async (req, res) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      date,
      paymentMethod,
      receiptUrl,
      receiptFilename
    } = req.body;

    const repo = getRepository();
    const transaction = await repo.createTransaction({
      userId: req.user.id,
      type,
      amount,
      category,
      description,
      date,
      paymentMethod,
      receiptUrl,
      receiptFilename
    });

    // Record CloudWatch business metrics
    cloudwatchService.recordTransactionMetric(type, category, amount).catch(() => {});

    // Budget threshold check for expenses
    if (type === 'expense') {
      try {
        const targetYear = parseInt(date.substring(0, 4), 10);
        const targetMonth = parseInt(date.substring(5, 7), 10);
        const budgetStatus = await repo.getBudgetStatus(req.user.id, targetYear, targetMonth);
        const catStatus = budgetStatus.categories.find(c => c.category.toLowerCase() === category.toLowerCase());

        if (catStatus && catStatus.limit > 0) {
          if (catStatus.isOverspent) {
            // Overspent alert
            await snsService.publishBudgetAlert({
              userId: req.user.id,
              userEmail: req.user.email,
              category,
              spent: catStatus.spent,
              limit: catStatus.limit,
              percentage: catStatus.percent
            });

            await repo.createNotification(req.user.id, {
              type: 'alert',
              title: `Overbudget Alert: ${category}`,
              message: `You spent ₹${catStatus.spent.toFixed(2)}, exceeding your monthly budget of ₹${catStatus.limit.toFixed(2)}.`
            });

            cloudwatchService.recordBudgetExceededMetric(category, catStatus.spent - catStatus.limit).catch(() => {});
          } else if (catStatus.isWarning) {
            // 80% warning
            await snsService.publishBudgetAlert({
              userId: req.user.id,
              userEmail: req.user.email,
              category,
              spent: catStatus.spent,
              limit: catStatus.limit,
              percentage: catStatus.percent
            });

            await repo.createNotification(req.user.id, {
              type: 'warning',
              title: `Budget Warning: ${category}`,
              message: `You have reached ${catStatus.percent}% of your monthly ${category} budget.`
            });
          }
        }
      } catch (alertErr) {
        console.warn('[Transactions:Alert] Non-fatal alert error:', alertErr.message);
      }
    }

    return res.status(201).json({
      message: 'Transaction recorded successfully.',
      transaction
    });
  } catch (err) {
    console.error('[Transactions:Create] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to record transaction.' });
  }
});

/**
 * Update an existing transaction
 */
router.put('/:id', validateTransaction, async (req, res) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      date,
      paymentMethod,
      receiptUrl,
      receiptFilename
    } = req.body;

    const repo = getRepository();
    const updated = await repo.updateTransaction(req.params.id, req.user.id, {
      type,
      amount,
      category,
      description,
      date,
      paymentMethod,
      receiptUrl,
      receiptFilename
    });

    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: 'Transaction not found.' });
    }

    return res.json({
      message: 'Transaction updated successfully.',
      transaction: updated
    });
  } catch (err) {
    console.error('[Transactions:Update] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update transaction.' });
  }
});

/**
 * Delete a transaction
 */
router.delete('/:id', async (req, res) => {
  try {
    const repo = getRepository();
    const deleted = await repo.deleteTransaction(req.params.id, req.user.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: 'Transaction not found or already deleted.' });
    }

    return res.json({ message: 'Transaction deleted successfully.' });
  } catch (err) {
    console.error('[Transactions:Delete] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete transaction.' });
  }
});

module.exports = router;
