const config = require('./index');
const ssmService = require('../services/ssmService');

/**
 * Initializes SSM configuration overlay if enabled.
 * Maps SSM parameter names to the app config keys.
 */
async function initializeConfiguration() {
  if (!config.aws.ssm.enabled) {
    return config;
  }

  try {
    const ssmParams = await ssmService.loadParameters(config.aws.ssm.prefix);

    // Overlay SSM parameters onto config object
    if (ssmParams.jwt_secret) config.auth.jwtSecret = ssmParams.jwt_secret;
    if (ssmParams.cognito_user_pool_id) config.aws.cognito.userPoolId = ssmParams.cognito_user_pool_id;
    if (ssmParams.cognito_client_id) config.aws.cognito.clientId = ssmParams.cognito_client_id;
    if (ssmParams.dynamodb_table_name) config.aws.dynamodb.tableName = ssmParams.dynamodb_table_name;
    if (ssmParams.s3_bucket_name) config.aws.s3.bucketName = ssmParams.s3_bucket_name;
    if (ssmParams.sns_topic_arn) config.aws.sns.topicArn = ssmParams.sns_topic_arn;
    if (ssmParams.storage_mode) config.storage.mode = ssmParams.storage_mode;
    if (ssmParams.auth_provider) config.auth.provider = ssmParams.auth_provider;

    console.log('[Config] Application configuration initialized with SSM parameters.');
  } catch (err) {
    console.warn('[Config] SSM initialization skipped, running with environment/default config:', err.message);
  }

  return config;
}

module.exports = {
  initializeConfiguration
};
