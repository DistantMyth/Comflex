/**
 * validators.js — Centralized Input & Security Validators
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Comprehensive Unicode regex matching:
// 1. Extended pictographics with skin tones (\u{1F3FB}-\u{1F3FF}), variation selectors (\u{FE0E}-\u{FE0F}), tag sequences (\u{E0020}-\u{E007F}), and zero-width joiner (\u{200D}) sequences
// 2. National flag pairs (\p{Regional_Indicator}{2})
// 3. Keycaps ([0-9#*]\uFE0F?\u20E3)
const EMOJI_REGEX = /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*(?:\u{200D}(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]*)*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u;

/**
 * Validate that input is a single valid Unicode emoji sequence.
 * Enforces strict length, prototype pollution protection, and rejects MongoDB path characters.
 *
 * @param {string} emoji - The emoji string to validate
 * @returns {string} The cleaned emoji string
 * @throws {Error} If invalid
 */
function validateEmoji(emoji) {
  if (typeof emoji !== 'string') {
    throw Object.assign(new Error('Emoji must be a string.'), { statusCode: 400, code: 'INVALID_EMOJI' });
  }
  const trimmed = emoji.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    throw Object.assign(new Error('Invalid emoji length.'), { statusCode: 400, code: 'INVALID_EMOJI' });
  }
  if (FORBIDDEN_KEYS.has(trimmed)) {
    throw Object.assign(new Error('Forbidden emoji identifier.'), { statusCode: 400, code: 'INVALID_EMOJI' });
  }
  if (trimmed.includes('.') || trimmed.includes('$') || trimmed.includes('\0')) {
    throw Object.assign(new Error('Emoji contains illegal characters.'), { statusCode: 400, code: 'INVALID_EMOJI' });
  }
  if (!EMOJI_REGEX.test(trimmed)) {
    throw Object.assign(new Error('Invalid emoji character sequence.'), { statusCode: 400, code: 'INVALID_EMOJI' });
  }
  return trimmed;
}

module.exports = {
  validateEmoji,
};
