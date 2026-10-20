const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand
} = require('@aws-sdk/client-dynamodb');
const config = require('../src/config');

async function initDynamoDB() {
  const tableName = config.aws.dynamodb.tableName;
  console.log(`[DynamoDB:Init] Initializing table "${tableName}" in region "${config.aws.region}"...`);

  const clientOptions = {
    region: config.aws.region
  };
  if (config.aws.credentials) {
    clientOptions.credentials = config.aws.credentials;
  }
  const client = new DynamoDBClient(clientOptions);

  try {
    // Check if table already exists
    try {
      const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`[DynamoDB:Init] Table "${tableName}" already exists. Status: ${desc.Table.TableStatus}`);
      return;
    } catch (err) {
      if (err.name !== 'ResourceNotFoundException') {
        throw err;
      }
    }

    console.log(`[DynamoDB:Init] Table "${tableName}" not found. Creating single-table schema...`);

    const command = new CreateTableCommand({
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
          Projection: {
            ProjectionType: 'ALL'
          }
        }
      ],
      Tags: [
        { Key: 'Application', Value: 'CloudSpend' },
        { Key: 'ManagedBy', Value: 'CloudSpend-CLI' }
      ]
    });

    const res = await client.send(command);
    console.log(`[DynamoDB:Init] CreateTable command sent. Table status: ${res.TableDescription.TableStatus}`);
    console.log(`[DynamoDB:Init] Table ARN: ${res.TableDescription.TableArn}`);
    console.log('[DynamoDB:Init] Ready. Single-table design provisioned successfully.');
  } catch (err) {
    console.error('[DynamoDB:Init] Failed to create DynamoDB table:', err.message);
    if (err.name === 'UnrecognizedClientException' || err.name === 'AccessDeniedException') {
      console.warn('[DynamoDB:Init] Please check your AWS credentials and IAM permissions for dynamodb:CreateTable.');
    }
    process.exit(1);
  }
}

if (require.main === module) {
  initDynamoDB();
}

module.exports = { initDynamoDB };
