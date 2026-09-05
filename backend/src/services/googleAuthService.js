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
 * Verify a Google ID token or Access token and extract user information.
 *
 * @param {string|{idToken?: string, accessToken?: string}} tokenInput - The token from frontend
 * @returns {Promise<{googleId: string, email: string, name: string, picture: string}>}
 * @throws {Error} If token is invalid or email domain doesn't match
 */
async function verifyGoogleToken(tokenInput) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw Object.assign(
      new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env.'),
      { statusCode: 500, code: 'GOOGLE_NOT_CONFIGURED' }
    );
  }

  let idToken = null;
  let accessToken = null;

  if (typeof tokenInput === 'string') {
    if (tokenInput.startsWith('ya29.')) {
      accessToken = tokenInput.trim();
    } else {
      idToken = tokenInput.trim();
    }
  } else if (tokenInput && typeof tokenInput === 'object') {
    idToken = typeof tokenInput.idToken === 'string' && tokenInput.idToken.trim() ? tokenInput.idToken.trim() : null;
    accessToken = typeof tokenInput.accessToken === 'string' && tokenInput.accessToken.trim() ? tokenInput.accessToken.trim() : null;
  }

  if (!idToken && !accessToken) {
    throw Object.assign(
      new Error('Google token is required.'),
      { statusCode: 400, code: 'MISSING_TOKEN' }
    );
  }

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  let googleUser = null;

  if (idToken) {
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

    if (payload.email_verified !== true) {
      throw Object.assign(
        new Error('Your Google email is not verified. Verify it with Google and try again.'),
        { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' }
      );
    }

    googleUser = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null,
    };
  } else if (accessToken) {
    let tokenInfo;
    try {
      tokenInfo = await client.getTokenInfo(accessToken);
    } catch (err) {
      throw Object.assign(
        new Error('Invalid Google access token.'),
        { statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' }
      );
    }

    const tokenAud = tokenInfo.aud || tokenInfo.azp;
    if (tokenAud && tokenAud !== env.GOOGLE_CLIENT_ID) {
      throw Object.assign(
        new Error('Google access token was not issued for this application client ID.'),
        { statusCode: 403, code: 'INVALID_AUDIENCE' }
      );
    }

    if (tokenInfo.email_verified !== true && tokenInfo.email_verified !== 'true') {
      throw Object.assign(
        new Error('Your Google email is not verified. Verify it with Google and try again.'),
        { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' }
      );
    }

    // Retrieve name and avatar from Google userinfo
    let profileName = null;
    let profilePicture = null;
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json();
        profileName = userInfo.name || null;
        profilePicture = userInfo.picture || null;
      }
    } catch {
      // Non-fatal: fallback to tokenInfo and email username
    }

    googleUser = {
      googleId: tokenInfo.sub,
      email: tokenInfo.email,
      name: profileName || tokenInfo.email.split('@')[0],
      picture: profilePicture || null,
    };
  }

  // Validate institution domain, exempting system admins and pre-existing admin accounts
  const normalizedEmail = googleUser.email.toLowerCase().trim();
  const isSeedAdmin = env.SEED_ADMIN_EMAIL && normalizedEmail === env.SEED_ADMIN_EMAIL.toLowerCase().trim();
  const existingAdmin = isSeedAdmin
    ? true
    : await prisma.user.findFirst({
        where: {
          OR: [{ googleId: googleUser.googleId }, { email: normalizedEmail }],
          globalRing: 0,
        },
      });

  if (!existingAdmin) {
    const config = await prisma.institutionConfig.findFirst();
    if (config && config.domain) {
      const emailDomain = normalizedEmail.split('@')[1]?.toLowerCase().trim();
      const configDomain = config.domain.toLowerCase().trim().replace(/^@/, '');
      if (emailDomain !== configDomain) {
        throw Object.assign(
          new Error(`Only emails from @${configDomain} are allowed. You used @${emailDomain}.`),
          { statusCode: 403, code: 'INVALID_DOMAIN' }
        );
      }
    }
  }

  return googleUser;
}

module.exports = { verifyGoogleToken };
