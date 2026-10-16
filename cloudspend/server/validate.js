"use strict";

const CATEGORIES = ["Food", "Bills", "Transport", "Education", "Health", "Entertainment", "Shopping", "Subscriptions", "Other"];
const PAYMENTS = ["UPI", "Card", "Cash", "Bank transfer", "Other"];
const MAX_AMOUNT_PAISE = 100000000000; // 1,000,000,000 rupees

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

// Accepts a number or numeric string with at most two decimals. Returns integer paise.
function toPaise(value, field = "amount") {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new ValidationError("Enter an amount greater than zero.", field);
  }
  const paise = Math.round(n * 100);
  if (Math.abs(n * 100 - paise) > 1e-6) {
    throw new ValidationError("Use at most two decimal places.", field);
  }
  if (paise < 1 || paise > MAX_AMOUNT_PAISE) {
    throw new ValidationError("That amount is out of range.", field);
  }
  return paise;
}

const fromPaise = (paise) => paise / 100;

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function requireDate(value, field = "date") {
  if (!isRealDate(value)) throw new ValidationError("Enter a valid date.", field);
  return value;
}

function requireMonth(value, field = "month") {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ValidationError("Enter a valid month (YYYY-MM).", field);
  }
  return value;
}

function requireText(value, field, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError("This field is required.", field);
  if (text.length > max) throw new ValidationError(`Use at most ${max} characters.`, field);
  return text;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ValidationError("Invalid text.", field);
  const text = value.trim();
  if (text.length > max) throw new ValidationError(`Use at most ${max} characters.`, field);
  return text;
}

// "Today" in the most generous timezone (UTC+14), so users east of UTC are not blocked.
function latestAllowedDate(now = new Date()) {
  const d = new Date(now.getTime() + 14 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// Earliest "today" anywhere on Earth (UTC-12), so a deadline of "today" is never rejected.
function earliestAllowedDate(now = new Date()) {
  return new Date(now.getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10);
}

function formatRupees(paise) {
  return "₹" + fromPaise(Math.max(0, paise)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function validateEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email) throw new ValidationError("Enter your email address.", "email");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ValidationError("Enter a valid email address.", "email");
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8) {
    throw new ValidationError("Use at least 8 characters.", "password");
  }
  if (Buffer.byteLength(value) > 72) {
    throw new ValidationError("Use at most 72 characters.", "password");
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new ValidationError("Include at least one letter and one number.", "password");
  }
  return value;
}

module.exports = {
  CATEGORIES, PAYMENTS, ValidationError,
  toPaise, fromPaise, isRealDate, requireDate, requireMonth,
  requireText, optionalText, latestAllowedDate, earliestAllowedDate, formatRupees, validateEmail, validatePassword
};
