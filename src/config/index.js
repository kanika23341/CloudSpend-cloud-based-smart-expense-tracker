const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env if present
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isTest: (process.env.NODE_ENV || 'development') === 'test',
  port: parseInt(process.env.PORT, 10) || 3000,
  appName: process.env.APP_NAME || 'CloudSpend',
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  // Authentication
  auth: {
    provider: process.env.AUTH_PROVIDER || 'local', // 'local' | 'cognito'
    jwtSecret: process.env.JWT_SECRET || 'cloudspend-default-super-secret-key-32chars',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    saltRounds: 10
  },

  // Storage
  storage: {
    mode: process.env.STORAGE_MODE || 'sqlite', // 'sqlite' | 'dynamodb'
    sqlitePath: process.env.SQLITE_DB_PATH
      ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
      : path.resolve(process.cwd(), 'data/cloudspend.db')
  },

  // AWS Configuration
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
    } : undefined, // Uses default AWS credential chain (IAM role, ~/.aws/credentials, SSO) if undefined

    // 1. Cognito
    cognito: {
      userPoolId: process.env.COGNITO_USER_POOL_ID || '',
      clientId: process.env.COGNITO_CLIENT_ID || '',
      clientSecret: process.env.COGNITO_CLIENT_SECRET || ''
    },

    // 2. DynamoDB
    dynamodb: {
      tableName: process.env.DYNAMODB_TABLE_NAME || 'CloudSpend-Main'
    },

    // 3. S3
    s3: {
      bucketName: process.env.S3_BUCKET_NAME || '',
      presignedExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 900
    },

    // 4. SNS
    sns: {
      topicArn: process.env.SNS_TOPIC_ARN || ''
    },

    // 5. CloudWatch
    cloudwatch: {
      enabled: process.env.CLOUDWATCH_METRICS_ENABLED === 'true',
      namespace: process.env.CLOUDWATCH_NAMESPACE || 'CloudSpend/App',
      logGroup: process.env.CLOUDWATCH_LOG_GROUP || '/cloudspend/application'
    },

    // 6. SSM Parameter Store
    ssm: {
      enabled: process.env.SSM_CONFIG_ENABLED === 'true',
      prefix: process.env.SSM_PARAM_PREFIX || '/cloudspend/config/'
    },

    // 7. Lambda
    lambda: {
      asyncReportWorker: process.env.ASYNC_REPORT_LAMBDA_NAME || 'CloudSpend-ReportWorker'
    },

    // 8. Serverless / API Gateway
    isServerless: process.env.IS_SERVERLESS === 'true'
  }
};

module.exports = config;
