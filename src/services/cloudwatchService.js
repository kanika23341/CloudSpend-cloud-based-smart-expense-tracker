const {
  CloudWatchClient,
  PutMetricDataCommand
} = require('@aws-sdk/client-cloudwatch');
const {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  CreateLogStreamCommand,
  DescribeLogStreamsCommand
} = require('@aws-sdk/client-cloudwatch-logs');
const config = require('../config');

class CloudWatchService {
  constructor() {
    this.metricClient = null;
    this.logsClient = null;
  }

  getMetricClient() {
    if (!this.metricClient) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.metricClient = new CloudWatchClient(clientOptions);
    }
    return this.metricClient;
  }

  getLogsClient() {
    if (!this.logsClient) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.logsClient = new CloudWatchLogsClient(clientOptions);
    }
    return this.logsClient;
  }

  isMetricsEnabled() {
    return Boolean(config.aws.cloudwatch.enabled);
  }

  /**
   * Puts a metric data point into AWS CloudWatch
   */
  async putMetric(metricName, value, unit = 'None', dimensions = []) {
    if (!this.isMetricsEnabled()) {
      return null;
    }

    try {
      const client = this.getMetricClient();
      const command = new PutMetricDataCommand({
        Namespace: config.aws.cloudwatch.namespace,
        MetricData: [
          {
            MetricName: metricName,
            Value: Number(value),
            Unit: unit,
            Timestamp: new Date(),
            Dimensions: dimensions
          }
        ]
      });

      await client.send(command);
    } catch (err) {
      // Metrics logging should not interrupt request flow
      console.warn(`[CloudWatch] Failed to emit metric ${metricName}: ${err.message}`);
    }
  }

  /**
   * Convenience helpers for CloudSpend business metrics
   */
  async recordTransactionMetric(type, category, amount) {
    if (!this.isMetricsEnabled()) return;

    await Promise.allSettled([
      this.putMetric('TransactionCount', 1, 'Count', [
        { Name: 'Type', Value: type },
        { Name: 'Category', Value: category }
      ]),
      this.putMetric('TransactionAmount', amount, 'None', [
        { Name: 'Type', Value: type }
      ])
    ]);
  }

  async recordBudgetExceededMetric(category, overAmount) {
    if (!this.isMetricsEnabled()) return;

    await this.putMetric('BudgetThresholdExceeded', 1, 'Count', [
      { Name: 'Category', Value: category }
    ]);
  }

  async recordApiLatencyMetric(path, method, statusCode, durationMs) {
    if (!this.isMetricsEnabled()) return;

    await this.putMetric('ApiLatency', durationMs, 'Milliseconds', [
      { Name: 'Path', Value: path },
      { Name: 'Method', Value: method },
      { Name: 'StatusCode', Value: String(statusCode) }
    ]);
  }

  /**
   * Structured logger that outputs JSON for CloudWatch Logs ingestion
   */
  log(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      appName: config.appName,
      env: config.env,
      ...meta
    };
    console.log(JSON.stringify(entry));
  }
}

module.exports = new CloudWatchService();
