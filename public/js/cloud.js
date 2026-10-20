/**
 * CloudSpend — AWS Cloud Architecture & Integration Monitoring Module
 */

const CloudModule = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const refreshBtn = document.getElementById('cloud-btn-refresh');
    const testAwsBtn = document.getElementById('cloud-btn-test-aws');
    const asyncWorkerBtn = document.getElementById('cloud-btn-trigger-async');
    const exportCsvBtn = document.getElementById('cloud-btn-export-csv');
    const exportJsonBtn = document.getElementById('cloud-btn-export-json');

    if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadStatus());
    if (testAwsBtn) testAwsBtn.addEventListener('click', () => this.testAwsConnections());
    if (asyncWorkerBtn) asyncWorkerBtn.addEventListener('click', () => this.triggerAsyncLambda());
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => this.exportStatement('csv'));
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => this.exportStatement('json'));
  },

  async testAwsConnections() {
    const banner = document.getElementById('cloud-test-results-banner');
    const content = document.getElementById('cloud-test-results-content');
    const testBtn = document.getElementById('cloud-btn-test-aws');

    banner.style.display = 'block';
    content.innerHTML = '<em>Pinging live AWS STS and service endpoints... please wait...</em>';
    testBtn.disabled = true;

    try {
      const report = await API.get('/api/system/test-aws');
      const sts = report.sts || {};
      const s = report.services || {};

      let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem;">
          <strong>Live AWS Service Diagnostics (${report.summary.connectedServices}/7 Connected)</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted);">Region: ${report.region} &bull; ${new Date(report.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 0.8125rem; margin-bottom: 0.75rem;">
          <strong>AWS Identity (STS):</strong> ${sts.status === 'CONNECTED' ? `<span style="color: var(--primary);">✅ Authenticated as <code>${sts.arn}</code> (${sts.latencyMs}ms)</span>` : `<span style="color: var(--danger);">❌ ${sts.message}</span>`}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.5rem; font-size: 0.8125rem;">
      `;

      const names = {
        cognito: '1. Cognito User Pools',
        dynamodb: '2. DynamoDB Single-Table',
        s3: '3. S3 Receipts & Exports',
        sns: '4. SNS Alert Topics',
        cloudwatch: '5. CloudWatch Metrics',
        ssm: '6. SSM Parameter Store',
        lambda: '7. Lambda Async Worker'
      };

      for (const [key, name] of Object.entries(names)) {
        const item = s[key] || { status: 'UNKNOWN', message: 'N/A' };
        let statusBadge = '';
        if (item.status === 'CONNECTED') {
          statusBadge = `<span class="badge badge-income" style="font-size:0.65rem;">CONNECTED (${item.latencyMs}ms)</span>`;
        } else if (item.status === 'NOT_CONFIGURED') {
          statusBadge = `<span class="badge badge-neutral" style="font-size:0.65rem;">NOT CONFIGURED</span>`;
        } else {
          statusBadge = `<span class="badge badge-expense" style="font-size:0.65rem;">ERROR / ACCESS DENIED</span>`;
        }

        html += `
          <div style="background: var(--bg-surface); padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid var(--border-light);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <strong>${name}</strong>
              ${statusBadge}
            </div>
            <div style="color: var(--text-secondary); font-size: 0.75rem;">${item.message}</div>
          </div>
        `;
      }

      html += '</div>';
      content.innerHTML = html;
      API.toast(`AWS Diagnostics complete: ${report.summary.connectedServices}/7 connected.`, 'info');
      this.loadStatus();
    } catch (err) {
      content.innerHTML = `<span style="color: var(--danger);">Failed to execute diagnostics: ${err.message}</span>`;
      API.toast(err.message, 'error');
    } finally {
      testBtn.disabled = false;
    }
  },

  async loadStatus() {
    try {
      const status = await API.get('/api/system/status');
      this.renderServiceCards(status);
    } catch (err) {
      console.warn('[CloudModule] Failed to fetch system status:', err);
    }
  },

  renderServiceCards(status) {
    const aws = status.awsServices || {};

    // 1. Cognito
    const cognitoEl = document.getElementById('cloud-status-cognito');
    const cognitoSub = document.getElementById('cloud-sub-cognito');
    if (aws.cognito && aws.cognito.configured) {
      cognitoEl.innerHTML = '<span style="color: var(--primary);">Active (AWS User Pool)</span>';
      cognitoSub.textContent = `Pool ID: ${aws.cognito.userPoolId}`;
    } else {
      cognitoEl.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (JWT + bcrypt)</span>';
      cognitoSub.textContent = 'Cognito integration ready';
    }

    // 2. DynamoDB
    const dynamoEl = document.getElementById('cloud-status-dynamodb');
    const dynamoSub = document.getElementById('cloud-sub-dynamodb');
    if (status.storageMode === 'dynamodb') {
      dynamoEl.innerHTML = '<span style="color: var(--primary);">Active (Single-Table)</span>';
      dynamoSub.textContent = `Table: ${aws.dynamodb.tableName}`;
    } else {
      dynamoEl.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (SQLite WAL)</span>';
      dynamoSub.textContent = 'DynamoDB repository ready';
    }

    // 3. S3
    const s3El = document.getElementById('cloud-status-s3');
    const s3Sub = document.getElementById('cloud-sub-s3');
    if (aws.s3 && aws.s3.configured) {
      s3El.innerHTML = '<span style="color: var(--primary);">Active (Presigned URLs)</span>';
      s3Sub.textContent = `Bucket: ${aws.s3.bucketName}`;
    } else {
      s3El.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (public/uploads/)</span>';
      s3Sub.textContent = 'S3 presigner ready';
    }

    // 4. SNS
    const snsEl = document.getElementById('cloud-status-sns');
    const snsSub = document.getElementById('cloud-sub-sns');
    if (aws.sns && aws.sns.configured) {
      snsEl.innerHTML = '<span style="color: var(--primary);">Active (Alert Topics)</span>';
      snsSub.textContent = `Topic ARN configured`;
    } else {
      snsEl.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (Event Logging)</span>';
      snsSub.textContent = 'SNS publisher ready';
    }

    // 5. CloudWatch
    const cwEl = document.getElementById('cloud-status-cloudwatch');
    const cwSub = document.getElementById('cloud-sub-cloudwatch');
    if (aws.cloudwatch && aws.cloudwatch.metricsEnabled) {
      cwEl.innerHTML = '<span style="color: var(--primary);">Active (Emitting Metrics)</span>';
      cwSub.textContent = `Namespace: ${aws.cloudwatch.namespace}`;
    } else {
      cwEl.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (Latency Tracked)</span>';
      cwSub.textContent = 'CloudWatch SDK v3 ready';
    }

    // 6. SSM Parameter Store
    const ssmEl = document.getElementById('cloud-status-ssm');
    const ssmSub = document.getElementById('cloud-sub-ssm');
    if (aws.ssm && aws.ssm.enabled) {
      ssmEl.innerHTML = '<span style="color: var(--primary);">Active (Parameter Store)</span>';
      ssmSub.textContent = `Prefix: ${aws.ssm.prefix}`;
    } else {
      ssmEl.innerHTML = '<span style="color: var(--text-secondary);">Local Mode (.env config)</span>';
      ssmSub.textContent = 'SSM loader ready';
    }

    // 7. Lambda Worker
    const lambdaEl = document.getElementById('cloud-status-lambda');
    const lambdaSub = document.getElementById('cloud-sub-lambda');
    if (aws.lambda && aws.lambda.workerConfigured) {
      lambdaEl.innerHTML = '<span style="color: var(--primary);">Active (Serverless Worker)</span>';
      lambdaSub.textContent = `Func: ${aws.lambda.workerFunctionName}`;
    } else {
      lambdaEl.innerHTML = '<span style="color: var(--text-secondary);">Local Async (setImmediate)</span>';
      lambdaSub.textContent = 'Lambda client ready';
    }

    // 8. API Gateway
    const apigwEl = document.getElementById('cloud-status-apigw');
    const apigwSub = document.getElementById('cloud-sub-apigw');
    if (aws.apiGateway && aws.apiGateway.isServerless) {
      apigwEl.innerHTML = '<span style="color: var(--primary);">Active (Lambda Proxy)</span>';
      apigwSub.textContent = 'Running behind API Gateway';
    } else {
      apigwEl.innerHTML = '<span style="color: var(--text-secondary);">Standalone Express</span>';
      apigwSub.textContent = 'Serverless adapter configured';
    }
  },

  async triggerAsyncLambda() {
    if (!AuthModule.currentUser) {
      API.toast('Please sign in first to run asynchronous report generation.', 'error');
      AuthModule.openModal('login');
      return;
    }

    const resultEl = document.getElementById('cloud-action-result');
    resultEl.innerHTML = '<em>Submitting asynchronous execution request to AWS Lambda worker...</em>';

    try {
      const res = await API.post('/api/reports/generate-async', {
        format: 'csv'
      });
      resultEl.innerHTML = `
        <div style="background: var(--primary-light); padding: 0.75rem; border-radius: 4px; border: 1px solid var(--primary-border);">
          <strong>Status: ${res.details.status}</strong> &mdash; ${res.message}<br>
          <span style="font-size: 0.8125rem;">Execution mode: <code>${res.details.mode}</code></span>
        </div>
      `;
      API.toast('Async report worker triggered!', 'success');
      App.loadNotifications();
    } catch (err) {
      resultEl.innerHTML = `<span style="color: var(--danger);">Failed: ${err.message}</span>`;
      API.toast(err.message, 'error');
    }
  },

  async exportStatement(format = 'csv') {
    if (!AuthModule.currentUser) {
      API.toast('Please sign in to generate statement exports.', 'error');
      AuthModule.openModal('login');
      return;
    }

    const resultEl = document.getElementById('cloud-action-result');
    resultEl.innerHTML = `<em>Generating ${format.toUpperCase()} financial statement and preparing secure download...</em>`;

    try {
      const res = await API.post('/api/reports/export-s3', { format });
      const downloadLink = res.downloadUrl || `/api/reports/download/${res.key}`;

      resultEl.innerHTML = `
        <div style="background: var(--bg-subtle); padding: 0.75rem; border-radius: 4px; border: 1px solid var(--border-color);">
          <strong>Export generated (${res.count} records)</strong><br>
          Storage: <code>${res.key}</code><br>
          <a href="${downloadLink}" target="_blank" class="btn btn-primary btn-sm" style="margin-top: 0.5rem; display: inline-block;">
            Download ${format.toUpperCase()} File
          </a>
        </div>
      `;
      API.toast(`Statement exported (${format.toUpperCase()})!`, 'success');
    } catch (err) {
      resultEl.innerHTML = `<span style="color: var(--danger);">Export failed: ${err.message}</span>`;
      API.toast(err.message, 'error');
    }
  }
};

window.CloudModule = CloudModule;
