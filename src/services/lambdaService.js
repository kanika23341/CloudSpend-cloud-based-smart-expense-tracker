const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const config = require('../config');

class LambdaService {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.client = new LambdaClient(clientOptions);
    }
    return this.client;
  }

  isConfigured() {
    return Boolean(config.aws.lambda.asyncReportWorker && config.aws.credentials);
  }

  /**
   * Invokes the background report worker Lambda asynchronously (InvocationType: 'Event')
   */
  async invokeAsyncReportWorker(payload) {
    if (!this.isConfigured()) {
      // Local fallback: execute worker in background without blocking
      const worker = require('../workers/asyncReportWorker');
      setImmediate(async () => {
        try {
          console.log('[Lambda:LocalFallback] Starting async worker processing...');
          await worker.handler(payload);
          console.log('[Lambda:LocalFallback] Completed async worker processing.');
        } catch (err) {
          console.error('[Lambda:LocalFallback] Worker processing failed:', err);
        }
      });

      return {
        mode: 'local-async',
        status: 'ACCEPTED',
        message: 'Async report generation started locally in background task.'
      };
    }

    try {
      const client = this.getClient();
      const command = new InvokeCommand({
        FunctionName: config.aws.lambda.asyncReportWorker,
        InvocationType: 'Event', // Asynchronous execution
        Payload: Buffer.from(JSON.stringify(payload))
      });

      const response = await client.send(command);
      console.log(`[Lambda] Asynchronously invoked ${config.aws.lambda.asyncReportWorker}. StatusCode: ${response.StatusCode}`);

      return {
        mode: 'aws-lambda',
        status: 'ACCEPTED',
        statusCode: response.StatusCode,
        functionName: config.aws.lambda.asyncReportWorker
      };
    } catch (err) {
      console.warn(`[Lambda] Failed to invoke Lambda worker (${err.message}). Falling back to local execution.`);
      const worker = require('../workers/asyncReportWorker');
      setImmediate(() => worker.handler(payload));
      return {
        mode: 'local-fallback',
        status: 'ACCEPTED',
        warning: err.message
      };
    }
  }
}

module.exports = new LambdaService();
