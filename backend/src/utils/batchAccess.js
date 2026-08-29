/**
 * batchAccess — Shared batch/cohort access rule for resources.
 *
 * A user may only touch resources of their own batch ("Batch XXXX") and the
 * batch directly below them (their immediate juniors). Global ring 0 bypasses.
 * Non-batch categories (Technical, etc.) are open to everyone.
 */

const { extractCohortYear } = require('../services/cohortService');

function enforceBatchAccess(req, targetSubCategory, yearGroup) {
  if (!req?.user) return false;
  if (req.user.globalRing === 0) return true; // Admins skip

  // If no subcategory is specified (e.g., Technical category), it's open to everyone
  if (!targetSubCategory) return true;

  const batchMatch = String(targetSubCategory).match(/^batch\s*(\d+)$/i);
  if (!batchMatch) return true; // Non-batch category (e.g. Technical)

  const myYear = extractCohortYear(req.user.cohortTags);
  if (!myYear) return false; // Fail closed if user has no assigned cohort

  const targetYear = parseInt(batchMatch[1], 10);
  if (isNaN(targetYear)) return false;

  // Juniors batch access check
  if (targetYear === myYear + 1) {
    // Non-admins can only see "Last Year" / "Past Year Paper" for their immediate juniors
    if (yearGroup && /this\s*year/i.test(String(yearGroup))) {
      return false;
    }
    return true;
  }

  return targetYear === myYear;
}

module.exports = { enforceBatchAccess };
