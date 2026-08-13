/**
 * anonIdentity — Zero-knowledge identity secrets for anonymous groups.
 *
 * Each anonymous group identity is authorized by a high-entropy secret that
 * ONLY the client holds. The server stores just a one-way HMAC of that
 * secret (peppered with the JWT access secret), so:
 *   - requests are verified by proving possession of the secret, and
 *   - the database contains no reversible material — even the platform
 *     operator cannot recover who a given alias belongs to.
 */

const crypto = require('crypto');
const env = require('../config/env');

const SECRET_BYTES = 32;

function pepper() {
  return env.JWT_ACCESS_SECRET;
}

/** Generate a fresh identity secret (given to the client exactly once). */
function issueSecret() {
  return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

/** One-way hash of a secret; the only thing the DB ever stores. */
function hashSecret(secret) {
  return crypto.createHmac('sha256', pepper()).update(secret).digest('hex');
}

/** Constant-time verification of a presented secret against a stored hash. */
function verifySecret(secret, storedHash) {
  if (!secret || !storedHash) return false;
  const presented = Buffer.from(hashSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presented.length !== stored.length) return false;
  return crypto.timingSafeEqual(presented, stored);
}

/** 4-digit disambiguator so identical-ish aliases stay distinguishable. */
function issueAliasTag() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

module.exports = { issueSecret, hashSecret, verifySecret, issueAliasTag };