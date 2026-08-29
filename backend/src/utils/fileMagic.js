const path = require('path');
const fs = require('fs');

const KNOWN_SIGNATURES = [
  // [name, matcher]
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ['gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ['webp', (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ['bmp', (b) => b[0] === 0x42 && b[1] === 0x4d],
  // PDF (%PDF)
  ['pdf', (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46],
  // ZIP / DOCX / PPTX / XLSX (PK\x03\x04 or PK\x05\x06 or PK\x07\x08)
  ['zip', (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)],
  // RAR
  ['rar', (b) => b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21],
  // 7z
  ['7z', (b) => b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf],
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
 * Verify that a stored file's header matches its claimed MIME family or extension.
 */
function validateStoredFile(filePath, claimedMime, originalName) {
  if (!filePath) return true;
  const detected = detectFileType(filePath);
  
  const ext = originalName ? path.extname(originalName).toLowerCase() : path.extname(filePath).toLowerCase();
  const mime = claimedMime ? String(claimedMime).toLowerCase() : '';

  // If claimed as or named as an image
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
    return ['jpeg', 'png', 'gif', 'webp', 'bmp'].includes(detected);
  }

  // If claimed as or named as a PDF
  if (mime === 'application/pdf' || mime === 'image/pdf' || ext === '.pdf') {
    return detected === 'pdf';
  }

  // If claimed as or named as a zip/docx/pptx/xlsx
  if (['.zip', '.docx', '.pptx', '.xlsx'].includes(ext)) {
    return detected === 'zip';
  }

  return true;
}

module.exports = { validateStoredFile, detectFileType };