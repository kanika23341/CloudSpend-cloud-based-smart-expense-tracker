const { SNSClient, PublishCommand, SubscribeCommand } = require('@aws-sdk/client-sns');
const config = require('../config');

class SNSService {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.client = new SNSClient(clientOptions);
    }
    return this.client;
  }

  isConfigured() {
    return Boolean(config.aws.sns.topicArn);
  }

  /**
   * Publishes a structured budget overspend / warning alert to SNS
   */
  async publishBudgetAlert({ userId, userEmail, category, spent, limit, percentage }) {
    const isOverspent = spent > limit;
    const subject = isOverspent
      ? `[CloudSpend ALERT] Budget Exceeded for ${category}`
      : `[CloudSpend WARNING] 80% Budget Threshold Reached for ${category}`;

    const message = [
      `CloudSpend Budget Notification`,
      `---------------------------------`,
      `User: ${userEmail || userId}`,
      `Category: ${category}`,
      `Monthly Limit: ₹${Number(limit).toFixed(2)}`,
      `Current Spend: ₹${Number(spent).toFixed(2)} (${percentage}% spent)`,
      isOverspent
        ? `Overspend Amount: ₹${(spent - limit).toFixed(2)}`
        : `Remaining Amount: ₹${(limit - spent).toFixed(2)}`,
      `Timestamp: ${new Date().toISOString()}`
    ].join('\n');

    if (!this.isConfigured()) {
      console.log(`[SNS:LocalFallback] ${subject}\n${message}`);
      return { local: true, subject, message };
    }

    try {
      const client = this.getClient();
      const command = new PublishCommand({
        TopicArn: config.aws.sns.topicArn,
        Subject: subject,
        Message: message,
        MessageAttributes: {
          AlertType: { DataType: 'String', StringValue: isOverspent ? 'OVERSPENT' : 'WARNING' },
          Category: { DataType: 'String', StringValue: category },
          UserId: { DataType: 'String', StringValue: userId }
        }
      });

      const response = await client.send(command);
      console.log(`[SNS] Budget alert published. MessageId: ${response.MessageId}`);
      return { s3: true, messageId: response.MessageId };
    } catch (err) {
      console.warn(`[SNS] Failed to publish alert to SNS: ${err.message}`);
      return { error: err.message };
    }
  }

  /**
   * Subscribes a user email directly to the SNS topic for budget notifications
   */
  async subscribeEmail(email) {
    if (!this.isConfigured()) {
      return { local: true, email, message: 'SNS not configured in local mode. Notification logged locally.' };
    }

    try {
      const client = this.getClient();
      const command = new SubscribeCommand({
        TopicArn: config.aws.sns.topicArn,
        Protocol: 'email',
        Endpoint: email.trim()
      });

      const response = await client.send(command);
      console.log(`[SNS] Subscription request sent for ${email}. SubscriptionArn: ${response.SubscriptionArn}`);
      return {
        success: true,
        subscriptionArn: response.SubscriptionArn,
        message: 'Subscription request sent. Please check your email to confirm the subscription.'
      };
    } catch (err) {
      console.warn(`[SNS] Failed to subscribe email: ${err.message}`);
      throw err;
    }
  }
}

module.exports = new SNSService();
