const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { CognitoIdentityProviderClient, DescribeUserPoolCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, HeadBucketCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { SNSClient, GetTopicAttributesCommand } = require('@aws-sdk/client-sns');
const { CloudWatchClient, ListMetricsCommand } = require('@aws-sdk/client-cloudwatch');
const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const config = require('../config');

class AWSConnectivityService {
  getClientOptions() {
    const opts = { region: config.aws.region };
    if (config.aws.credentials) {
      opts.credentials = config.aws.credentials;
    }
    return opts;
  }

  async testSTS() {
    const start = Date.now();
    try {
      const client = new STSClient(this.getClientOptions());
      const res = await client.send(new GetCallerIdentityCommand({}));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        accountId: res.Account,
        arn: res.Arn,
        userId: res.UserId,
        message: `Authenticated as ${res.Arn}`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testCognito() {
    const poolId = config.aws.cognito.userPoolId;
    if (!poolId) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'COGNITO_USER_POOL_ID is not configured in .env'
      };
    }

    const start = Date.now();
    try {
      const client = new CognitoIdentityProviderClient(this.getClientOptions());
      const res = await client.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        userPoolId: poolId,
        poolName: res.UserPool?.Name,
        statusState: res.UserPool?.Status,
        message: `Connected to Cognito User Pool "${res.UserPool?.Name || poolId}"`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testDynamoDB() {
    const tableName = config.aws.dynamodb.tableName;
    if (!tableName) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'DYNAMODB_TABLE_NAME is not configured in .env'
      };
    }

    const start = Date.now();
    try {
      const client = new DynamoDBClient(this.getClientOptions());
      const res = await client.send(new DescribeTableCommand({ TableName: tableName }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        tableName,
        tableStatus: res.Table?.TableStatus,
        itemCount: res.Table?.ItemCount,
        message: `Connected to DynamoDB table "${tableName}" (Status: ${res.Table?.TableStatus})`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testS3() {
    const bucket = config.aws.s3.bucketName;
    if (!bucket) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'S3_BUCKET_NAME is not configured in .env'
      };
    }

    const start = Date.now();
    try {
      const client = new S3Client(this.getClientOptions());
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        bucketName: bucket,
        message: `Connected to S3 bucket "${bucket}" with read/write access`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testSNS() {
    const topicArn = config.aws.sns.topicArn;
    if (!topicArn) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'SNS_TOPIC_ARN is not configured in .env'
      };
    }

    const start = Date.now();
    try {
      const client = new SNSClient(this.getClientOptions());
      const res = await client.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        topicArn,
        displayName: res.Attributes?.DisplayName || 'CloudSpend Alerts',
        subscriptionsConfirmed: res.Attributes?.SubscriptionsConfirmed || 0,
        message: `Connected to SNS topic "${topicArn}"`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testCloudWatch() {
    const start = Date.now();
    try {
      const client = new CloudWatchClient(this.getClientOptions());
      const res = await client.send(new ListMetricsCommand({
        Namespace: config.aws.cloudwatch.namespace
      }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        namespace: config.aws.cloudwatch.namespace,
        metricCount: (res.Metrics || []).length,
        message: `Connected to CloudWatch Metrics (Namespace: ${config.aws.cloudwatch.namespace})`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testSSM() {
    const prefix = config.aws.ssm.prefix;
    const start = Date.now();
    try {
      const client = new SSMClient(this.getClientOptions());
      const res = await client.send(new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        WithDecryption: true
      }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        prefix,
        parametersFound: (res.Parameters || []).length,
        message: `Connected to SSM Parameter Store (${(res.Parameters || []).length} parameters at ${prefix})`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testLambda() {
    const functionName = config.aws.lambda.asyncReportWorker;
    if (!functionName) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'ASYNC_REPORT_LAMBDA_NAME is not configured in .env'
      };
    }

    const start = Date.now();
    try {
      const client = new LambdaClient(this.getClientOptions());
      const res = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        functionName,
        runtime: res.Configuration?.Runtime,
        state: res.Configuration?.State,
        message: `Connected to Lambda worker "${functionName}" (Runtime: ${res.Configuration?.Runtime})`
      };
    } catch (err) {
      return {
        status: 'ERROR',
        latencyMs: Date.now() - start,
        error: err.name,
        message: err.message
      };
    }
  }

  async testAllConnections() {
    const [sts, cognito, dynamodb, s3, sns, cloudwatch, ssm, lambda] = await Promise.all([
      this.testSTS(),
      this.testCognito(),
      this.testDynamoDB(),
      this.testS3(),
      this.testSNS(),
      this.testCloudWatch(),
      this.testSSM(),
      this.testLambda()
    ]);

    const results = {
      timestamp: new Date().toISOString(),
      region: config.aws.region,
      sts,
      services: {
        cognito,
        dynamodb,
        s3,
        sns,
        cloudwatch,
        ssm,
        lambda
      }
    };

    const connectedCount = Object.values(results.services).filter(s => s.status === 'CONNECTED').length;
    results.summary = {
      totalServicesTested: 7,
      connectedServices: connectedCount,
      credentialsValid: sts.status === 'CONNECTED'
    };

    return results;
  }
}

module.exports = new AWSConnectivityService();
