const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const config = require('../config');

class DynamoDBService {
  constructor() {
    this.rawClient = null;
    this.docClient = null;
  }

  getRawClient() {
    if (!this.rawClient) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.rawClient = new DynamoDBClient(clientOptions);
    }
    return this.rawClient;
  }

  getDocClient() {
    if (!this.docClient) {
      const raw = this.getRawClient();
      this.docClient = DynamoDBDocumentClient.from(raw, {
        marshallOptions: {
          removeUndefinedValues: true,
          convertEmptyValues: false
        }
      });
    }
    return this.docClient;
  }

  get tableName() {
    return config.aws.dynamodb.tableName;
  }
}

module.exports = new DynamoDBService();
