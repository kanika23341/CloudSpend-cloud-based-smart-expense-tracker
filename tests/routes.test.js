const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { closeDatabase } = require('../src/db/sqlite');

describe('API Route Integration Tests', () => {
  let app;
  let authToken;
  let createdTransactionId;

  before(() => {
    app = createApp();
  });

  after(() => {
    closeDatabase();
  });

  it('GET /health returns healthy system status', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.appName, 'CloudSpend');
  });

  it('GET /api/system/status reports cloud service integration details', async () => {
    const res = await request(app).get('/api/system/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.awsServices);
    assert.ok('cognito' in res.body.awsServices);
    assert.ok('dynamodb' in res.body.awsServices);
    assert.ok('s3' in res.body.awsServices);
    assert.ok('sns' in res.body.awsServices);
    assert.ok('cloudwatch' in res.body.awsServices);
    assert.ok('ssm' in res.body.awsServices);
    assert.ok('lambda' in res.body.awsServices);
    assert.ok('apiGateway' in res.body.awsServices);
  });

  it('GET /api/system/test-aws executes live cloud diagnostics suite', async () => {
    const res = await request(app).get('/api/system/test-aws');
    assert.equal(res.status, 200);
    assert.ok(res.body.sts);
    assert.ok(res.body.services);
    assert.ok(res.body.summary);
    assert.equal(typeof res.body.summary.connectedServices, 'number');
  });

  it('POST /api/auth/register successfully registers a user', async () => {
    const uniqueEmail = `test_${Date.now()}@cloudspend.test`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail,
        password: 'Password123!',
        name: 'Integration Tester',
        defaultMonthlyIncome: 6000
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.name, 'Integration Tester');
    assert.equal(res.body.user.defaultMonthlyIncome, 6000);

    authToken = res.body.token;
  });

  it('GET /api/transactions fails with 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/transactions');
    assert.equal(res.status, 401);
  });

  it('GET /api/auth/me returns current user profile with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Integration Tester');
  });

  it('POST /api/budgets configures a category budget', async () => {
    const res = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        category: 'Groceries',
        monthlyLimit: 500
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.budget.category, 'Groceries');
    assert.equal(res.body.budget.monthly_limit, 500);
  });

  it('POST /api/transactions creates a valid transaction', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: 'expense',
        amount: 85.50,
        category: 'Groceries',
        description: 'Weekly organic produce',
        date: '2026-10-14',
        paymentMethod: 'Credit Card'
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.transaction.id);
    assert.equal(res.body.transaction.amount, 85.50);
    assert.equal(res.body.transaction.category, 'Groceries');

    createdTransactionId = res.body.transaction.id;
  });

  it('GET /api/transactions retrieves user transactions with pagination', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, createdTransactionId);
  });

  it('POST /api/transactions/by-dates queries transactions for multi-date selection', async () => {
    const res = await request(app)
      .post('/api/transactions/by-dates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        dates: ['2026-10-14', '2026-10-15']
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.totalExpense, 85.50);
  });

  it('GET /api/budgets/status computes budget tracking and remaining balance', async () => {
    const res = await request(app)
      .get('/api/budgets/status?year=2026&month=10')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalBudget, 500);
    assert.equal(res.body.totalSpent, 85.50);
    assert.equal(res.body.totalRemaining, 414.50);
  });

  it('DELETE /api/transactions/:id deletes the transaction', async () => {
    const res = await request(app)
      .delete(`/api/transactions/${createdTransactionId}`)
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(res.status, 200);

    const getRes = await request(app)
      .get(`/api/transactions/${createdTransactionId}`)
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(getRes.status, 404);
  });
});
