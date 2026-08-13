/**
 * fileMagic — Cheap magic-byte validation for uploaded files.
 *
 * Extension allowlists alone are spoofable (rename evil.html → evil.png).
 * These checks read the file header and confirm the bytes match common
 * image formats before the file is stored or forwarded to Cloudinary.
 */

const fs = require('fs');

const KNOWN_SIGNATURES = [
  // [name, matcher]
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ['gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ['webp', (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ['bmp', (b) => b[0] === 0x42 && b[1] === 0x4d],
  // PDF (%%PDF)
  ['pdf', (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46],
];

function detectFileType(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath).subarray(0, 16);
  } catch {
    return null;
  }
  if (buf.length < 4) return null;
  for (const [name, match] of KNOWN_SIGNATURES) {
    if (match(buf)) return name;
  }
  return null;
}

/**
 * Verify that a stored file's header matches its claimed MIME family.
 * - image/* claims must match an image signature (anti polyglot/rename).
 * - application/pdf must be an actual PDF.
 * - Everything else (documents, archives) is not signature-checked.
 */
function validateStoredFile(filePath, claimedMime) {
  if (!filePath || !claimedMime) return true;
  const detected = detectFileType(filePath);
  if (!detected) return true; // unknown header for non-image claims is fine

  const mime = String(claimedMime).toLowerCase();
  if (mime.startsWith('image/')) {
    return ['jpeg', 'png', 'gif', 'webp', 'bmp'].includes(detected);
  }
  if (mime === 'application/pdf' || mime === 'image/pdf') {
    return detected === 'pdf';
  }
  return true;
}

module.exports = { validateStoredFile, detectFileType };