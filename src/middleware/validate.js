/**
 * Lightweight and robust input validation middleware
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ['expense', 'income'];
const VALID_PAYMENT_METHODS = [
  'Cash',
  'Debit Card',
  'Credit Card',
  'Bank Transfer',
  'Digital Wallet',
  'Other'
];

function validateRegister(req, res, next) {
  const { email, password, name } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: 'Validation Error', message: 'A valid email address is required.' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Password must be at least 8 characters in length.'
    });
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Validation Error', message: 'Full name is required.' });
  }

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: 'Validation Error', message: 'A valid email address is required.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Validation Error', message: 'Password is required.' });
  }

  next();
}

function validateTransaction(req, res, next) {
  const { type, amount, category, description, date, paymentMethod } = req.body || {};

  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({
      error: 'Validation Error',
      message: `Invalid transaction type. Must be either 'expense' or 'income'.`
    });
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Amount must be a positive number greater than 0.'
    });
  }

  if (!category || typeof category !== 'string' || category.trim().length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Category is required and cannot be blank.'
    });
  }

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Description is required and cannot be blank.'
    });
  }

  if (!date || typeof date !== 'string' || !DATE_REGEX.test(date.trim())) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Date must be formatted as YYYY-MM-DD.'
    });
  }

  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    req.body.paymentMethod = 'Other';
  }

  next();
}

function validateBudget(req, res, next) {
  const { category, monthlyLimit } = req.body || {};

  if (!category || typeof category !== 'string' || category.trim().length === 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Category is required.'
    });
  }

  const numLimit = Number(monthlyLimit);
  if (isNaN(numLimit) || numLimit < 0) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Monthly limit must be a number greater than or equal to 0.'
    });
  }

  next();
}

module.exports = {
  validateRegister,
  validateLogin,
  validateTransaction,
  validateBudget
};
