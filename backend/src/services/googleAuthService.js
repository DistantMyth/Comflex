/**
 * Google Auth Service
 *
 * Verifies Google ID tokens and validates that the user's email
 * belongs to the configured institution domain.
 *
 * Uses the `google-auth-library` package to verify tokens against
 * Google's public keys — no Passport.js needed.
 */

const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const prisma = require('../prisma');

/**
 * Verify a Google ID token and extract user information.
 *
 * @param {string} idToken - The Google ID token from the frontend
 * @returns {Promise<{googleId: string, email: string, name: string, picture: string}>}
 * @throws {Error} If token is invalid or email domain doesn't match
 */
async function verifyGoogleToken(idToken) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw Object.assign(
      new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env.'),
      { statusCode: 500, code: 'GOOGLE_NOT_CONFIGURED' }
    );
  }

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw Object.assign(
      new Error('Invalid Google ID token.'),
      { statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' }
    );
  }

  const payload = ticket.getPayload();

  if (!payload || !payload.email) {
    throw Object.assign(
      new Error('Google token does not contain an email.'),
      { statusCode: 401, code: 'MISSING_EMAIL' }
    );
  }

  // Only accept verified Google identities — an unverified email is not
  // proof the user controls the mailbox (spoofed-domain signups).
  if (payload.email_verified !== true) {
    throw Object.assign(
      new Error('Your Google email is not verified. Verify it with Google and try again.'),
      { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' }
    );
  }

  // Validate that the email belongs to the configured institution domain
  const config = await prisma.institutionConfig.findFirst();
  if (config && config.domain) {
    const emailDomain = payload.email.split('@')[1]?.toLowerCase();
    const configDomain = config.domain.toLowerCase();
    if (emailDomain !== configDomain) {
      throw Object.assign(
        new Error(`Only emails from @${config.domain} are allowed. You used @${emailDomain}.`),
        { statusCode: 403, code: 'INVALID_DOMAIN' }
      );
    }
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleToken };
