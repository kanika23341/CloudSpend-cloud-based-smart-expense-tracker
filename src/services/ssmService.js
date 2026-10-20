const { SSMClient, GetParametersByPathCommand, GetParameterCommand } = require('@aws-sdk/client-ssm');
const config = require('../config');

class SSMService {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  getClient() {
    if (!this.client) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.client = new SSMClient(clientOptions);
    }
    return this.client;
  }

  /**
   * Fetch all parameters under a path prefix (e.g., /cloudspend/config/)
   * Decrypts SecureString parameters automatically.
   */
  async loadParameters(pathPrefix = config.aws.ssm.prefix) {
    if (!config.aws.ssm.enabled) {
      return {};
    }

    try {
      const client = this.getClient();
      const params = {};
      let nextToken;

      do {
        const command = new GetParametersByPathCommand({
          Path: pathPrefix,
          Recursive: true,
          WithDecryption: true,
          NextToken: nextToken
        });

        const response = await client.send(command);
        if (response.Parameters) {
          for (const param of response.Parameters) {
            // Extract the key name relative to prefix
            const key = param.Name.replace(pathPrefix, '').replace(/^\//, '');
            params[key] = param.Value;
          }
        }
        nextToken = response.NextToken;
      } while (nextToken);

      console.log(`[SSM] Successfully loaded ${Object.keys(params).length} parameters from ${pathPrefix}`);
      return params;
    } catch (err) {
      console.warn(`[SSM] Failed to load parameters from SSM (${err.message}). Falling back to local configuration.`);
      return {};
    }
  }

  /**
   * Fetch a single parameter by name
   */
  async getParameter(name, withDecryption = true) {
    try {
      const client = this.getClient();
      const command = new GetParameterCommand({
        Name: name,
        WithDecryption: withDecryption
      });
      const response = await client.send(command);
      return response.Parameter ? response.Parameter.Value : null;
    } catch (err) {
      console.warn(`[SSM] Unable to get parameter ${name}: ${err.message}`);
      return null;
    }
  }
}

module.exports = new SSMService();
