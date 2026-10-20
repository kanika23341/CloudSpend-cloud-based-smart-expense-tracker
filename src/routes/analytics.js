const express = require('express');
const { getRepository } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * Monthly financial summary (income, expenses, balance, savings rate)
 */
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const repo = getRepository();
    const summary = await repo.getMonthlySummary(req.user.id, year, month);

    return res.json(summary);
  } catch (err) {
    console.error('[Analytics:Summary] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute monthly summary.' });
  }
});

/**
 * Category breakdown (totals and percentages for pie/doughnut chart)
 */
router.get('/breakdown', async (req, res) => {
  try {
    const { startDate, endDate, type = 'expense' } = req.query;
    const repo = getRepository();

    const breakdown = await repo.getCategoryBreakdown(req.user.id, startDate, endDate, type);
    return res.json({ breakdown });
  } catch (err) {
    console.error('[Analytics:Breakdown] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute category breakdown.' });
  }
});

/**
 * Historical spending trends (monthly income vs expense for bar/line charts)
 */
router.get('/trends', async (req, res) => {
  try {
    const months = Math.min(24, Math.max(2, parseInt(req.query.months, 10) || 6));
    const repo = getRepository();

    const trends = await repo.getSpendingTrends(req.user.id, months);
    return res.json({ trends });
  } catch (err) {
    console.error('[Analytics:Trends] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute spending trends.' });
  }
});

/**
 * Quarterly financial comparison for a given year
 */
router.get('/quarterly', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const repo = getRepository();

    const quarters = await repo.getQuarterlyComparison(req.user.id, year);
    return res.json({ year, quarters });
  } catch (err) {
    console.error('[Analytics:Quarterly] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute quarterly comparisons.' });
  }
});

/**
 * Daily spending numbers for calendar and heatmap
 */
router.get('/daily', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);

    const repo = getRepository();
    const daily = await repo.getDailySpending(req.user.id, year, month);

    return res.json({ year, month, daily });
  } catch (err) {
    console.error('[Analytics:Daily] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to compute daily spending.' });
  }
});

module.exports = router;
