const express = require('express');
const { getRepository } = require('../db');
const { requireAuth } = require('../middleware/auth');
const snsService = require('../services/snsService');

const router = express.Router();
router.use(requireAuth);

/**
 * List user notifications
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
    const repo = getRepository();
    const notifications = await repo.getNotifications(req.user.id, limit);
    return res.json({ notifications });
  } catch (err) {
    console.error('[Notifications:List] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve notifications.' });
  }
});

/**
 * Mark a single notification as read
 */
router.put('/:id/read', async (req, res) => {
  try {
    const repo = getRepository();
    await repo.markNotificationRead(req.params.id, req.user.id);
    return res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    console.error('[Notifications:Read] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update notification.' });
  }
});

/**
 * Mark all notifications as read
 */
router.post('/read-all', async (req, res) => {
  try {
    const repo = getRepository();
    await repo.markAllNotificationsRead(req.user.id);
    return res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('[Notifications:ReadAll] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to mark all as read.' });
  }
});

/**
 * Subscribe user to AWS SNS budget & transaction notifications via email
 */
router.post('/subscribe-sns', async (req, res) => {
  try {
    const email = req.body.email || req.user.email;
    const result = await snsService.subscribeEmail(email);

    return res.json({
      message: result.message || 'Subscription requested.',
      details: result
    });
  } catch (err) {
    console.error('[Notifications:SubscribeSNS] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: `Failed to subscribe: ${err.message}` });
  }
});

module.exports = router;
