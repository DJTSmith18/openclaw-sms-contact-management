'use strict';

/**
 * Strip non-digits and take the last 10 characters.
 * Matches the voipms-sms normalizePhone exactly.
 */
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

/**
 * Validate that a string is a safe SQL identifier (table/column name).
 * Alphanumeric + underscore only, must start with letter or underscore.
 */
function isSafeSqlIdent(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

module.exports = { normalizePhone, isSafeSqlIdent };
