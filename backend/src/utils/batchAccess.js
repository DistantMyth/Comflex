/**
 * batchAccess — Shared batch/cohort access rule for resources.
 *
 * A user may only touch resources of their own batch ("Batch XXXX") and the
 * batch directly below them (their immediate juniors). Global ring 0 bypasses.
 * Non-batch categories (Technical, etc.) are open to everyone.
 */

const { extractCohortYear } = require('../services/cohortService');

function enforceBatchAccess(req, targetSubCategory) {
  if (req.user.globalRing === 0) return true; // Admins skip
  if (!targetSubCategory || !targetSubCategory.startsWith('Batch ')) return true; // Technical or other

  const myYear = extractCohortYear(req.user.cohortTags);
  if (!myYear) return true; // Fallback if user has no assigned cohort

  const targetYear = parseInt(targetSubCategory.replace('Batch ', ''), 10);
  if (!isNaN(targetYear)) {
    return targetYear === myYear || targetYear === myYear + 1;
  }
  return true;
}

module.exports = { enforceBatchAccess };
