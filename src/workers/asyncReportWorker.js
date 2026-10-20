const { getRepository } = require('../db');
const s3Service = require('../services/s3Service');
const snsService = require('../services/snsService');
const cloudwatchService = require('../services/cloudwatchService');

/**
 * Standalone AWS Lambda handler for background financial report generation.
 * Can be triggered directly by API Gateway -> Lambda async invocation, or EventBridge cron schedule.
 */
exports.handler = async (event, context) => {
  console.log('[Worker:Report] Received event:', JSON.stringify(event));

  const payload = typeof event === 'string' ? JSON.parse(event) : event;
  const { userId, userEmail, year, month, format = 'csv' } = payload || {};

  if (!userId) {
    console.error('[Worker:Report] Missing required parameter: userId');
    return { statusCode: 400, body: 'Missing userId' };
  }

  const repo = getRepository();
  const targetYear = year || new Date().getFullYear();
  const targetMonth = month || (new Date().getMonth() + 1);

  try {
    // 1. Gather data
    const summary = await repo.getMonthlySummary(userId, targetYear, targetMonth);
    const breakdown = await repo.getCategoryBreakdown(
      userId,
      `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`,
      `${targetYear}-${String(targetMonth).padStart(2, '0')}-31`,
      'expense'
    );
    const transactions = await repo.listTransactions(userId, {
      startDate: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`,
      endDate: `${targetYear}-${String(targetMonth).padStart(2, '0')}-31`,
      limit: 1000
    });

    let fileBuffer;
    let contentType;
    let extension;

    if (format === 'json') {
      const reportJson = JSON.stringify({
        generatedAt: new Date().toISOString(),
        user: { id: userId, email: userEmail },
        period: { year: targetYear, month: targetMonth },
        summary,
        breakdown,
        transactions: transactions.data
      }, null, 2);
      fileBuffer = Buffer.from(reportJson, 'utf-8');
      contentType = 'application/json';
      extension = 'json';
    } else {
      // CSV format
      const header = 'Date,Type,Category,Description,Amount,PaymentMethod\n';
      const rows = transactions.data.map(t =>
        `"${t.date}","${t.type}","${t.category}","${(t.description || '').replace(/"/g, '""')}",${t.amount},"${t.payment_method}"`
      ).join('\n');
      const csvContent = `${header}${rows}\n\n# Summary: Total Income: ₹${summary.totalIncome}, Total Expense: ₹${summary.totalExpense}, Net Savings: ₹${summary.netSavings}\n`;
      fileBuffer = Buffer.from(csvContent, 'utf-8');
      contentType = 'text/csv';
      extension = 'csv';
    }

    // 2. Upload to S3 or local storage
    const key = `exports/${userId}/report-${targetYear}-${String(targetMonth).padStart(2, '0')}-${Date.now()}.${extension}`;
    const uploadResult = await s3Service.uploadExportFile(key, fileBuffer, contentType);

    // 3. Emit CloudWatch metric
    await cloudwatchService.putMetric('FinancialReportsGenerated', 1, 'Count', [
      { Name: 'Format', Value: format }
    ]);

    // 4. Save notification to user ledger
    const downloadLink = uploadResult.downloadUrl || uploadResult.path;
    await repo.createNotification(userId, {
      type: 'info',
      title: `Financial Report Ready (${summary.monthFormatted})`,
      message: `Your ${format.toUpperCase()} monthly report has been processed. Storage location: ${uploadResult.key}`
    });

    // 5. Publish to SNS if user email or topic configured
    if (snsService.isConfigured()) {
      await snsService.getClient(); // checks connectivity
    }

    console.log(`[Worker:Report] Successfully processed report for user ${userId}. Location: ${key}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        fileKey: key,
        downloadUrl: downloadLink,
        summary
      })
    };
  } catch (err) {
    console.error('[Worker:Report] Failed generating report:', err);
    throw err;
  }
};
