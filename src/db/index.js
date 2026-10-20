const config = require('../config');
const SqliteRepository = require('./sqliteRepository');
const DynamoDbRepository = require('./dynamoRepository');

let repositoryInstance = null;

function getRepository() {
  if (!repositoryInstance) {
    if (config.storage.mode === 'dynamodb') {
      console.log(`[Repository] Using AWS DynamoDB storage provider (table: ${config.aws.dynamodb.tableName})`);
      repositoryInstance = new DynamoDbRepository();
    } else {
      console.log(`[Repository] Using SQLite storage provider (path: ${config.storage.sqlitePath})`);
      repositoryInstance = new SqliteRepository();
    }
  }
  return repositoryInstance;
}

// For testing or switching repositories on the fly
function setRepository(repo) {
  repositoryInstance = repo;
}

module.exports = {
  getRepository,
  setRepository,
  SqliteRepository,
  DynamoDbRepository
};
