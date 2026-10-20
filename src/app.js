const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { cloudwatchMetricsMiddleware } = require('./middleware/cloudwatch');

// Import route modules
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const analyticsRoutes = require('./routes/analytics');
const budgetRoutes = require('./routes/budgets');
const receiptRoutes = require('./routes/receipts');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const healthRoutes = require('./routes/health');

function createApp() {
  const app = express();

  // Basic security and parsing middlewares
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // CloudWatch operational metrics middleware
  app.use(cloudwatchMetricsMiddleware);

  // Serve static assets from public/ directory
  app.use(express.static(path.resolve(process.cwd(), 'public')));

  // Mount API endpoints
  app.use(healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/budgets', budgetRoutes);
  app.use('/api/receipts', receiptRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);

  // SPA fallback for HTML client navigation
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
      return next();
    }
    const indexPath = path.resolve(process.cwd(), 'public/index.html');
    return res.sendFile(indexPath);
  });

  // 404 handler for unmatched API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: 'Not Found',
        message: `API route ${req.method} ${req.originalUrl} does not exist.`
      });
    }
    next();
  });

  // Global secure error handling middleware
  app.use((err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;
    const isDev = config.isDev;

    console.error(`[Express:Error] ${req.method} ${req.url} - ${err.message}`, isDev ? err.stack : '');

    return res.status(statusCode).json({
      error: err.name || 'Internal Server Error',
      message: err.message || 'An unexpected error occurred.',
      ...(isDev ? { stack: err.stack } : {})
    });
  });

  return app;
}

module.exports = {
  createApp
};
