const jwt = require('jsonwebtoken');
const config = require('../config');
const cognitoService = require('../services/cognitoService');
const { getRepository } = require('../db');

/**
 * Authentication middleware that extracts, verifies, and validates tokens.
 * Supports both local JWT authentication and AWS Cognito User Pool tokens.
 * Always populates req.user with trusted user details from verified tokens.
 */
async function requireAuth(req, res, next) {
  try {
    let token = null;

    // 1. Check Authorization Bearer header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    // 2. Fall back to httpOnly cookie if present
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token missing or invalid. Please sign in.'
      });
    }

    const repo = getRepository();

    // 3. AWS Cognito token path
    if (config.auth.provider === 'cognito' && cognitoService.isConfigured()) {
      try {
        const cognitoUser = await cognitoService.verifyAccessToken(token);
        // Find or create local user record for isolated data integrity
        let localUser = await repo.getUserByEmail(cognitoUser.email);
        if (!localUser) {
          localUser = await repo.createUser({
            id: cognitoUser.id,
            email: cognitoUser.email,
            passwordHash: 'COGNITO_MANAGED',
            name: cognitoUser.name || cognitoUser.email.split('@')[0]
          });
        }
        req.user = {
          id: localUser.id,
          email: localUser.email,
          name: localUser.name,
          defaultMonthlyIncome: localUser.default_monthly_income || 0,
          authProvider: 'cognito'
        };
        return next();
      } catch (cognitoErr) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: `Cognito token verification failed: ${cognitoErr.message}`
        });
      }
    }

    // 4. Local JWT token path
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      if (!decoded || !decoded.userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Malformed authentication token.' });
      }

      const user = await repo.getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized', message: 'User account no longer exists.' });
      }

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultMonthlyIncome: user.default_monthly_income || 0,
        authProvider: 'local'
      };

      return next();
    } catch (jwtErr) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session token. Please sign in again.'
      });
    }
  } catch (err) {
    console.error('[Auth Middleware] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Authentication processing error.' });
  }
}

module.exports = {
  requireAuth
};
