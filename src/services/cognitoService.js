const crypto = require('crypto');
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  GetUserCommand,
  ConfirmSignUpCommand
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('../config');

class CognitoService {
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
      this.client = new CognitoIdentityProviderClient(clientOptions);
    }
    return this.client;
  }

  isConfigured() {
    return Boolean(config.aws.cognito.userPoolId && config.aws.cognito.clientId);
  }

  calculateSecretHash(username) {
    if (!config.aws.cognito.clientSecret) {
      return undefined;
    }
    return crypto
      .createHmac('sha256', config.aws.cognito.clientSecret)
      .update(username + config.aws.cognito.clientId)
      .digest('base64');
  }

  async signUp(email, password, name) {
    if (!this.isConfigured()) {
      throw new Error('AWS Cognito is not configured. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID.');
    }

    const client = this.getClient();
    const cleanEmail = email.toLowerCase().trim();
    const secretHash = this.calculateSecretHash(cleanEmail);

    const command = new SignUpCommand({
      ClientId: config.aws.cognito.clientId,
      Username: cleanEmail,
      Password: password,
      SecretHash: secretHash,
      UserAttributes: [
        { Name: 'email', Value: cleanEmail },
        { Name: 'name', Value: name.trim() }
      ]
    });

    const response = await client.send(command);
    return {
      userSub: response.UserSub,
      userConfirmed: response.UserConfirmed
    };
  }

  async signIn(email, password) {
    if (!this.isConfigured()) {
      throw new Error('AWS Cognito is not configured.');
    }

    const client = this.getClient();
    const cleanEmail = email.toLowerCase().trim();
    const secretHash = this.calculateSecretHash(cleanEmail);

    const authParameters = {
      USERNAME: cleanEmail,
      PASSWORD: password
    };
    if (secretHash) {
      authParameters.SECRET_HASH = secretHash;
    }

    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.aws.cognito.clientId,
      AuthParameters: authParameters
    });

    const response = await client.send(command);
    const authResult = response.AuthenticationResult;

    if (!authResult) {
      throw new Error('Authentication challenge required or invalid response from Cognito');
    }

    // Retrieve user details from Cognito
    const userCommand = new GetUserCommand({
      AccessToken: authResult.AccessToken
    });
    const userRes = await client.send(userCommand);

    const attributes = {};
    for (const attr of userRes.UserAttributes) {
      attributes[attr.Name] = attr.Value;
    }

    return {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
      expiresIn: authResult.ExpiresIn,
      user: {
        id: attributes.sub,
        email: attributes.email || cleanEmail,
        name: attributes.name || cleanEmail.split('@')[0]
      }
    };
  }

  async verifyAccessToken(accessToken) {
    if (!this.isConfigured()) {
      throw new Error('AWS Cognito is not configured.');
    }

    const client = this.getClient();
    const command = new GetUserCommand({
      AccessToken: accessToken
    });

    const response = await client.send(command);
    const attributes = {};
    for (const attr of response.UserAttributes) {
      attributes[attr.Name] = attr.Value;
    }

    return {
      id: attributes.sub,
      email: attributes.email,
      name: attributes.name
    };
  }
}

module.exports = new CognitoService();
