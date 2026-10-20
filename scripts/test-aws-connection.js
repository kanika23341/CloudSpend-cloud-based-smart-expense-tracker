const awsConnectivity = require('../src/services/awsConnectivity');
const config = require('../src/config');

async function runCliDiagnostics() {
  console.log('================================================================');
  console.log('   CloudSpend — Live AWS Cloud Connectivity Diagnostics');
  console.log(`   Region: ${config.aws.region} | Environment: ${config.env}`);
  console.log('================================================================\n');

  console.log('Testing AWS Credentials and Live Service Endpoints...\n');

  const report = await awsConnectivity.testAllConnections();

  // 1. STS / Credentials
  console.log('----------------------------------------------------------------');
  console.log('  AWS Authentication (STS):');
  if (report.sts.status === 'CONNECTED') {
    console.log(`  [OK] Authenticated successfully in ${report.sts.latencyMs}ms`);
    console.log(`       Account ID : ${report.sts.accountId}`);
    console.log(`       IAM ARN    : ${report.sts.arn}`);
  } else {
    console.log(`  [FAIL] ${report.sts.error}: ${report.sts.message}`);
    console.log('         Tip: Provide AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY or run "aws configure".');
  }
  console.log('----------------------------------------------------------------\n');

  // 2. Individual Services
  const services = report.services;
  const serviceList = [
    { key: 'cognito', name: '1. AWS Cognito (User Pools)' },
    { key: 'dynamodb', name: '2. AWS DynamoDB (Single-Table)' },
    { key: 's3', name: '3. AWS S3 (Receipts & Exports)' },
    { key: 'sns', name: '4. AWS SNS (Budget Alerts)' },
    { key: 'cloudwatch', name: '5. AWS CloudWatch (Metrics & Alarms)' },
    { key: 'ssm', name: '6. AWS SSM (Parameter Store)' },
    { key: 'lambda', name: '7. AWS Lambda (Async Report Worker)' }
  ];

  for (const s of serviceList) {
    const res = services[s.key];
    console.log(`  ${s.name}:`);
    if (res.status === 'CONNECTED') {
      console.log(`    Status  : [CONNECTED] (${res.latencyMs}ms)`);
      console.log(`    Details : ${res.message}`);
    } else if (res.status === 'NOT_CONFIGURED') {
      console.log(`    Status  : [NOT CONFIGURED]`);
      console.log(`    Message : ${res.message}`);
    } else {
      console.log(`    Status  : [ERROR / ACCESS DENIED] (${res.latencyMs}ms)`);
      console.log(`    Details : ${res.error} - ${res.message}`);
    }
    console.log('');
  }

  console.log('================================================================');
  console.log(`  Summary: ${report.summary.connectedServices} of ${report.summary.totalServicesTested} AWS services connected.`);
  if (report.summary.connectedServices >= 6) {
    console.log('  Status : [EXCELLENT] Production Cloud integration is active!');
  } else if (report.summary.credentialsValid) {
    console.log('  Status : AWS credentials valid. Configure missing resources via .env or "npm run aws:setup".');
  } else {
    console.log('  Status : Running in Local Development Mode (SQLite fallback active).');
  }
  console.log('================================================================');
}

if (require.main === module) {
  runCliDiagnostics().catch(err => {
    console.error('Diagnostic error:', err);
    process.exit(1);
  });
}

module.exports = { runCliDiagnostics };
