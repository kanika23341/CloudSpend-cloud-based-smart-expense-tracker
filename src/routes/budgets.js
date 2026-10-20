const express = require('express');
const { getRepository } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateBudget } = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

/**
 * Get all configured budgets for the user
 */
router.get('/', async (req, res) => {
  try {
    const repo = getRepository();
    const budgets = await repo.getBudgets(req.user.id);
    return res.json({ budgets });
  } catch (err) {
    console.error('[Budgets:List] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve budgets.' });
  }
});

/**
 * Get budget tracking status for a specific month (spending vs limits, alerts)
 */
router.get('/status', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const repo = getRepository();
    const status = await repo.getBudgetStatus(req.user.id, year, month);

    // Also get user profile for default monthly income
    const user = await repo.getUserById(req.user.id);
    status.defaultMonthlyIncome = user ? (user.default_monthly_income || 0) : 0;

    return res.json(status);
  } catch (err) {
    console.error('[Budgets:Status] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute budget status.' });
  }
});

/**
 * Create or update a budget limit for a category
 */
router.post('/', validateBudget, async (req, res) => {
  try {
    const { category, monthlyLimit } = req.body;
    const repo = getRepository();

    const budget = await repo.setBudget(req.user.id, category, monthlyLimit);
    return res.json({
      message: 'Budget limit saved successfully.',
      budget
    });
  } catch (err) {
    console.error('[Budgets:Set] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to save budget limit.' });
  }
});

/**
 * Delete a budget for a category
 */
router.delete('/:category', async (req, res) => {
  try {
    const repo = getRepository();
    const deleted = await repo.deleteBudget(req.user.id, req.params.category);

    return res.json({
      message: deleted ? 'Budget removed successfully.' : 'Budget category not found.'
    });
  } catch (err) {
    console.error('[Budgets:Delete] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete budget.' });
  }
});

/**
 * Update default monthly income in user profile
 */
router.put('/default-income', async (req, res) => {
  try {
    const { amount } = req.body;
    const num = Number(amount);
    if (isNaN(num) || num < 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Default income must be a non-negative number.' });
    }

    const repo = getRepository();
    const updated = await repo.updateUserProfile(req.user.id, { defaultMonthlyIncome: num });

    return res.json({
      message: 'Default monthly income updated.',
      defaultMonthlyIncome: updated.default_monthly_income
    });
  } catch (err) {
    console.error('[Budgets:DefaultIncome] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update default income.' });
  }
});

module.exports = router;
