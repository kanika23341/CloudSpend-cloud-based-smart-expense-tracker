const cloudwatchService = require('../services/cloudwatchService');

/**
 * Tracks response time and sends operational metrics to AWS CloudWatch
 */
function cloudwatchMetricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const path = req.baseUrl || req.path || '/';
    const method = req.method;
    const statusCode = res.statusCode;

    // Send metrics asynchronously without awaiting
    cloudwatchService.recordApiLatencyMetric(path, method, statusCode, duration).catch(() => {});

    if (statusCode >= 500) {
      cloudwatchService.putMetric('Http5xxErrors', 1, 'Count', [
        { Name: 'Path', Value: path }
      ]).catch(() => {});
    }
  });

  next();
}

module.exports = {
  cloudwatchMetricsMiddleware
};
