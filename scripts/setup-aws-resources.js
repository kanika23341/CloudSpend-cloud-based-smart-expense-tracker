const fs = require('fs');
const path = require('path');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, CreateBucketCommand, PutBucketCorsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { SNSClient, CreateTopicCommand } = require('@aws-sdk/client-sns');
const { CloudWatchLogsClient, CreateLogGroupCommand, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const config = require('../src/config');

async function setupAwsResources() {
  console.log('================================================================');
  console.log('  CloudSpend — Automated AWS Resource Provisioner');
  console.log('================================================================\n');

  const clientOpts = { region: config.aws.region };
  if (config.aws.credentials) {
    clientOpts.credentials = config.aws.credentials;
  }

  // 1. Verify STS credentials
  console.log('[1/6] Verifying AWS Identity...');
  const sts = new STSClient(clientOpts);
  let accountId;
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account;
    console.log(`      Authenticated as: ${identity.Arn}`);
    console.log(`      Account ID:       ${accountId}`);
    console.log(`      Region:           ${config.aws.region}\n`);
  } catch (err) {
    console.error('      Failed to authenticate with AWS:', err.message);
    console.log('\n      Please configure your AWS credentials in .env:');
    console.log('      AWS_ACCESS_KEY_ID=your_key');
    console.log('      AWS_SECRET_ACCESS_KEY=your_secret');
    console.log('      AWS_REGION=us-east-1');
    process.exit(1);
  }

  const envUpdates = {};

  // 2. Provision DynamoDB Table
  console.log('[2/6] Provisioning DynamoDB Single-Table ("CloudSpend-Main")...');
  const dynamo = new DynamoDBClient(clientOpts);
  const tableName = config.aws.dynamodb.tableName || 'CloudSpend-Main';
  try {
    try {
      await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`      DynamoDB table "${tableName}" already exists.`);
    } catch (e) {
      if (e.name === 'ResourceNotFoundException') {
        await dynamo.send(new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
            { AttributeName: 'GSI1PK', AttributeType: 'S' },
            { AttributeName: 'GSI1SK', AttributeType: 'S' }
          ],
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' }
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'GSI1',
              KeySchema: [
                { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                { AttributeName: 'GSI1SK', KeyType: 'RANGE' }
              ],
              Projection: { ProjectionType: 'ALL' }
            }
          ]
        }));
        console.log(`      Created DynamoDB table "${tableName}".`);
      } else {
        throw e;
      }
    }
    envUpdates.DYNAMODB_TABLE_NAME = tableName;
    envUpdates.STORAGE_MODE = 'dynamodb';
  } catch (err) {
    console.warn(`      DynamoDB creation warning: ${err.message}`);
  }

  // 3. Create S3 Bucket
  console.log('\n[3/6] Provisioning S3 Bucket for Receipts & Statement Exports...');
  const s3 = new S3Client(clientOpts);
  const bucketName = config.aws.s3.bucketName || `cloudspend-assets-${accountId}-${config.aws.region}`;
  try {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      console.log(`      S3 bucket "${bucketName}" already exists.`);
    } catch (e) {
      const bucketConfig = config.aws.region === 'us-east-1' ? {} : {
        CreateBucketConfiguration: { LocationConstraint: config.aws.region }
      };
      await s3.send(new CreateBucketCommand({
        Bucket: bucketName,
        ...bucketConfig
      }));
      console.log(`      Created S3 bucket "${bucketName}".`);
    }

    // Configure CORS for direct browser PUT uploads
    await s3.send(new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
            AllowedOrigins: ['*'],
            MaxAgeSeconds: 3600
          }
        ]
      }
    }));
    console.log(`      Configured CORS on S3 bucket "${bucketName}".`);
    envUpdates.S3_BUCKET_NAME = bucketName;
  } catch (err) {
    console.warn(`      S3 provisioning warning: ${err.message}`);
  }

  // 4. Create SNS Alerts Topic
  console.log('\n[4/6] Provisioning Amazon SNS Budget Alerts Topic...');
  const sns = new SNSClient(clientOpts);
  try {
    const topicRes = await sns.send(new CreateTopicCommand({
      Name: 'CloudSpend-BudgetAlerts',
      Attributes: { DisplayName: 'CloudSpend Budget Notifications' }
    }));
    console.log(`      SNS Topic created: ${topicRes.TopicArn}`);
    envUpdates.SNS_TOPIC_ARN = topicRes.TopicArn;
  } catch (err) {
    console.warn(`      SNS creation warning: ${err.message}`);
  }

  // 5. Create CloudWatch Log Group
  console.log('\n[5/6] Provisioning CloudWatch Log Group & Metrics...');
  const cwLogs = new CloudWatchLogsClient(clientOpts);
  const logGroupName = config.aws.cloudwatch.logGroup || '/cloudspend/application';
  try {
    try {
      await cwLogs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: logGroupName }));
    } catch (e) {
      // ignore
    }
    await cwLogs.send(new CreateLogGroupCommand({ logGroupName })).catch(() => {});
    console.log(`      CloudWatch Log Group "${logGroupName}" ready.`);
    envUpdates.CLOUDWATCH_METRICS_ENABLED = 'true';
    envUpdates.CLOUDWATCH_LOG_GROUP = logGroupName;
  } catch (err) {
    console.warn(`      CloudWatch warning: ${err.message}`);
  }

  // 6. Store Configuration in SSM Parameter Store
  console.log('\n[6/6] Writing Configuration to SSM Parameter Store...');
  const ssm = new SSMClient(clientOpts);
  try {
    const prefix = config.aws.ssm.prefix || '/cloudspend/config/';
    await ssm.send(new PutParameterCommand({
      Name: `${prefix}jwt_secret`,
      Value: config.auth.jwtSecret,
      Type: 'SecureString',
      Overwrite: true
    }));
    await ssm.send(new PutParameterCommand({
      Name: `${prefix}app_name`,
      Value: 'CloudSpend',
      Type: 'String',
      Overwrite: true
    }));
    console.log(`      SSM parameters saved under "${prefix}".`);
    envUpdates.SSM_CONFIG_ENABLED = 'true';
  } catch (err) {
    console.warn(`      SSM Parameter Store warning: ${err.message}`);
  }

  // Summary & .env updater
  console.log('\n================================================================');
  console.log('  PROVISIONING COMPLETE! Suggested .env overrides:');
  console.log('================================================================');
  for (const [k, v] of Object.entries(envUpdates)) {
    console.log(`${k}=${v}`);
  }

  // Optionally update .env directly
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, 'utf-8');
    for (const [k, v] of Object.entries(envUpdates)) {
      const reg = new RegExp(`^${k}=.*$`, 'm');
      if (reg.test(content)) {
        content = content.replace(reg, `${k}=${v}`);
      } else {
        content += `\n${k}=${v}`;
      }
    }
    fs.writeFileSync(envPath, content, 'utf-8');
    console.log('\nUpdated .env with active AWS configuration values.');
  }

  console.log('\nRun "npm run test:aws" to verify connectivity to all provisioned services.');
}

if (require.main === module) {
  setupAwsResources().catch(err => {
    console.error('Fatal provisioning error:', err);
    process.exit(1);
  });
}

module.exports = { setupAwsResources };
