/**
 * parseEmail — Utility to extract academic info from IIITL student emails.
 *
 * Email format: L<BranchCode><YearOfAdmission><RollNo>@iiitl.ac.in
 *
 * Branch codes:
 *   CS → Computer Science
 *   CI → Artificial Intelligence
 *   CB → CS-Business
 *
 * Regex: /^l(cs|ci|cb)(\d{4})(\d{3,})@iiitl\.ac\.in$/i
 *   Group 1 → branch code
 *   Group 2 → 4-digit year of admission
 *   Group 3 → roll number (3+ digits)
 */

const IIITL_EMAIL_REGEX = /^l(cs|ci|cb)(\d{4})(\d{3,})@iiitl\.ac\.in$/i;

const BRANCH_MAP = {
  cs: 'Computer Science',
  ci: 'Artificial Intelligence',
  cb: 'CS-Business',
};

/**
 * Parse an IIITL student email to extract academic information.
 *
 * @param {string} email - The email address to parse
 * @returns {{ branch: string, branchCode: string, yearOfAdmission: string, rollNumber: string } | null}
 *   Parsed info or null if the email doesn't match the IIITL format.
 */
export function parseIIITLEmail(email) {
  if (!email) return null;

  const match = email.match(IIITL_EMAIL_REGEX);
  if (!match) return null;

  const branchCode = match[1].toUpperCase();
  const yearOfAdmission = match[2];
  const rollNumber = match[3];

  return {
    branch: BRANCH_MAP[branchCode.toLowerCase()] || branchCode,
    branchCode,
    yearOfAdmission,
    rollNumber,
  };
}
