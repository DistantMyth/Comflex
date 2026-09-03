/**
 * parseEmail — Utility to extract academic info from college student emails.
 */

const EMAIL_REGEX = /^l?(cs|ci|cb|it|ece|me|ee|ce)?(\d{4})(\d{3,})@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/i;

const BRANCH_MAP = {
  cs: 'Computer Science',
  ci: 'Artificial Intelligence',
  cb: 'CS-Business',
  it: 'Information Technology',
  ece: 'Electronics & Communication',
};

export function parseStudentEmail(email) {
  if (!email) return null;

  const match = email.match(EMAIL_REGEX);
  if (!match) return null;

  const branchCode = (match[1] || 'GEN').toUpperCase();
  const yearOfAdmission = match[2];
  const rollNumber = match[3];

  return {
    branch: BRANCH_MAP[branchCode.toLowerCase()] || branchCode,
    branchCode,
    yearOfAdmission,
    rollNumber,
  };
}

export const parseIIITLEmail = parseStudentEmail;
export default parseStudentEmail;
