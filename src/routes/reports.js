const express = require('express');
const path = require('path');
const fs = require('fs');
const { getRepository } = require('../db');
const { requireAuth } = require('../middleware/auth');
const s3Service = require('../services/s3Service');
const lambdaService = require('../services/lambdaService');

const router = express.Router();
router.use(requireAuth);

/**
 * Direct export to CSV or JSON with S3 storage and presigned download URL
 */
router.post('/export-s3', async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate } = req.body;
    const repo = getRepository();

    const txResult = await repo.listTransactions(req.user.id, {
      startDate,
      endDate,
      limit: 5000
    });

    let buffer;
    let contentType;
    let extension;

    if (format === 'json') {
      buffer = Buffer.from(JSON.stringify(txResult.data, null, 2), 'utf-8');
      contentType = 'application/json';
      extension = 'json';
    } else {
      const header = 'ID,Date,Type,Category,Description,Amount,PaymentMethod,CreatedAt\n';
      const rows = txResult.data.map(t =>
        `"${t.id}","${t.date}","${t.type}","${t.category}","${(t.description || '').replace(/"/g, '""')}",${t.amount},"${t.payment_method}","${t.created_at}"`
      ).join('\n');
      buffer = Buffer.from(`${header}${rows}`, 'utf-8');
      contentType = 'text/csv';
      extension = 'csv';
    }

    const key = `exports/${req.user.id}/transactions-export-${Date.now()}.${extension}`;
    const result = await s3Service.uploadExportFile(key, buffer, contentType);

    return res.json({
      message: 'Statement export generated successfully.',
      ...result,
      count: txResult.data.length
    });
  } catch (err) {
    console.error('[Reports:ExportS3] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to generate report export.' });
  }
});

/**
 * Trigger asynchronous AWS Lambda background worker to generate monthly report
 */
router.post('/generate-async', async (req, res) => {
  try {
    const now = new Date();
    const {
      year = now.getFullYear(),
      month = now.getMonth() + 1,
      format = 'csv'
    } = req.body;

    const payload = {
      userId: req.user.id,
      userEmail: req.user.email,
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      format
    };

    const result = await lambdaService.invokeAsyncReportWorker(payload);

    return res.status(202).json({
      message: 'Asynchronous report generation has been queued.',
      details: result
    });
  } catch (err) {
    console.error('[Reports:GenerateAsync] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to dispatch async worker.' });
  }
});

/**
 * Download locally saved exports
 */
router.get('/download/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.resolve(process.cwd(), 'data/exports', safeFilename);

  if (fs.existsSync(filePath)) {
    return res.download(filePath);
  }

  return res.status(404).json({ error: 'Not Found', message: 'Export file not found.' });
});

module.exports = router;
