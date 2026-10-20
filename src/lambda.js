const serverlessExpress = require('@vendia/serverless-express');
const { createApp } = require('./app');
const { initializeConfiguration } = require('./config/ssmConfig');

let serverlessExpressInstance;

async function setupLambda(event, context) {
  // Load SSM parameters in cloud mode
  await initializeConfiguration();
  const app = createApp();
  serverlessExpressInstance = serverlessExpress({ app });
  return serverlessExpressInstance(event, context);
}

exports.handler = async (event, context) => {
  if (serverlessExpressInstance) {
    return serverlessExpressInstance(event, context);
  }
  return setupLambda(event, context);
};
