const express = require('express');
const config = require('../config');
const cognitoService = require('../services/cognitoService');
const s3Service = require('../services/s3Service');
const snsService = require('../services/snsService');
const cloudwatchService = require('../services/cloudwatchService');
const ssmService = require('../services/ssmService');
const lambdaService = require('../services/lambdaService');
const awsConnectivity = require('../services/awsConnectivity');

const router = express.Router();

router.get('/health', (req, res) => {
  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    appName: config.appName,
    version: '1.0.0',
    env: config.env
  });
});

/**
 * Live AWS Connectivity Diagnostic Suite
 * Actively performs real SDK v3 calls against STS, Cognito, DynamoDB, S3, SNS, CloudWatch, SSM, and Lambda.
 */
router.get('/api/system/test-aws', async (req, res) => {
  try {
    const report = await awsConnectivity.testAllConnections();
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Diagnostic Error', message: err.message });
  }
});

router.post('/api/system/test-aws', async (req, res) => {
  try {
    const report = await awsConnectivity.testAllConnections();
    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Diagnostic Error', message: err.message });
  }
});

router.get('/api/system/status', (req, res) => {
  const status = {
    appName: config.appName,
    environment: config.env,
    storageMode: config.storage.mode,
    authProvider: config.auth.provider,
    awsRegion: config.aws.region,
    awsServices: {
      cognito: {
        configured: cognitoService.isConfigured(),
        userPoolId: config.aws.cognito.userPoolId || null,
        clientId: config.aws.cognito.clientId || null
      },
      dynamodb: {
        active: config.storage.mode === 'dynamodb',
        tableName: config.aws.dynamodb.tableName
      },
      s3: {
        configured: s3Service.isConfigured(),
        bucketName: config.aws.s3.bucketName || null
      },
      sns: {
        configured: snsService.isConfigured(),
        topicArn: config.aws.sns.topicArn || null
      },
      cloudwatch: {
        metricsEnabled: cloudwatchService.isMetricsEnabled(),
        namespace: config.aws.cloudwatch.namespace
      },
      ssm: {
        enabled: config.aws.ssm.enabled,
        prefix: config.aws.ssm.prefix
      },
      lambda: {
        workerConfigured: lambdaService.isConfigured(),
        workerFunctionName: config.aws.lambda.asyncReportWorker
      },
      apiGateway: {
        isServerless: config.aws.isServerless
      }
    }
  };

  return res.json(status);
});

module.exports = router;
