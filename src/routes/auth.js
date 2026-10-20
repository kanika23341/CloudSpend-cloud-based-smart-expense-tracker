const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getRepository } = require('../db');
const { validateRegister, validateLogin } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const cognitoService = require('../services/cognitoService');

const router = express.Router();

/**
 * Register a new user
 * In Cognito mode, creates user in Cognito User Pool and mirrors profile.
 * In Local mode, hashes password with bcrypt and stores in database.
 */
router.post('/register', validateRegister, async (req, res) => {
  try {
    const { email, password, name, defaultMonthlyIncome = 0 } = req.body;
    const repo = getRepository();

    // Check if user already exists
    const existing = await repo.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }

    let userId;

    if (config.auth.provider === 'cognito' && cognitoService.isConfigured()) {
      try {
        const cognitoResult = await cognitoService.signUp(email, password, name);
        userId = cognitoResult.userSub;
      } catch (cognitoErr) {
        return res.status(400).json({
          error: 'Registration Failed',
          message: `Cognito registration error: ${cognitoErr.message}`
        });
      }
    }

    const salt = await bcrypt.genSalt(config.auth.saltRounds);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await repo.createUser({
      id: userId,
      email,
      passwordHash,
      name,
      defaultMonthlyIncome: Number(defaultMonthlyIncome) || 0
    });

    // Create session token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.auth.cookieSecure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultMonthlyIncome: user.default_monthly_income || 0
      }
    });
  } catch (err) {
    console.error('[Auth:Register] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create account.' });
  }
});

/**
 * Log in an existing user
 */
router.post('/login', validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;
    const repo = getRepository();

    // Cognito authentication path
    if (config.auth.provider === 'cognito' && cognitoService.isConfigured()) {
      try {
        const authResult = await cognitoService.signIn(email, password);

        // Ensure user exists in our local repository
        let localUser = await repo.getUserByEmail(email);
        if (!localUser) {
          localUser = await repo.createUser({
            id: authResult.user.id,
            email: authResult.user.email,
            passwordHash: 'COGNITO_MANAGED',
            name: authResult.user.name
          });
        }

        res.cookie('token', authResult.accessToken, {
          httpOnly: true,
          secure: config.auth.cookieSecure,
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
          message: 'Sign in successful.',
          token: authResult.accessToken,
          user: {
            id: localUser.id,
            email: localUser.email,
            name: localUser.name,
            defaultMonthlyIncome: localUser.default_monthly_income || 0
          }
        });
      } catch (cognitoErr) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: `Cognito authentication failed: ${cognitoErr.message}`
        });
      }
    }

    // Local authentication path
    const user = await repo.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.'
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.auth.cookieSecure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      message: 'Sign in successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultMonthlyIncome: user.default_monthly_income || 0
      }
    });
  } catch (err) {
    console.error('[Auth:Login] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to sign in.' });
  }
});

/**
 * Log out user (clears auth cookie)
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ message: 'Signed out successfully.' });
});

/**
 * Get currently authenticated user profile
 */
router.get('/me', requireAuth, async (req, res) => {
  const repo = getRepository();
  const user = await repo.getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'Not Found', message: 'User not found.' });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      defaultMonthlyIncome: user.default_monthly_income || 0,
      authProvider: req.user.authProvider
    }
  });
});

/**
 * Update user profile (name, default monthly income)
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, defaultMonthlyIncome } = req.body;
    const repo = getRepository();

    const updated = await repo.updateUserProfile(req.user.id, {
      name,
      defaultMonthlyIncome
    });

    return res.json({
      message: 'Profile updated successfully.',
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        defaultMonthlyIncome: updated.default_monthly_income || 0
      }
    });
  } catch (err) {
    console.error('[Auth:Profile] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update profile.' });
  }
});

module.exports = router;
