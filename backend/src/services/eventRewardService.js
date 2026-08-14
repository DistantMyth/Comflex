/**
 * Event reward engine.
 *
 * Everything that moves credits/badges for events goes through payoutRule:
 * auto rewards on correct submissions, rank distributions and ad-hoc manual
 * grants all share the same atomic, auditable path.
 *
 * Funding model:
 *   - Rules/grants whose funder is a global admin (ring 0) MINT credits and
 *     may use any badge.
 *   - Everyone else pays out of their own pocket: credits are debited from
 *     the funder's creditBalance, and every badge they give must already be
 *     in their inventory.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Sane per-rule limits for pocket-funded (non-admin) rules. Admins are uncapped.
const ORGANIZER_RULE_LIMITS = {
  creditsPerUser: 500,
  maxUses: 100,
  badgesPerRule: 3,
};
const MAX_RULES_PER_EVENT = 50;
const RULE_TRIGGERS = ['submission', 'rank'];

class RewardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isObjectId(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

/**
 * Validate + normalize reward rule input from a request body.
 * Admin-created rules are uncapped; organizer rules are clamped to sane values.
 */
function sanitizeRuleInput(body, actorIsAdmin) {
  const raw = body || {};
  const trigger = RULE_TRIGGERS.includes(raw.trigger) ? raw.trigger : null;

  const creditsPerUser = Math.floor(Number(raw.creditsPerUser));
  const safeCredits = Number.isFinite(creditsPerUser)
    ? Math.max(0, Math.min(creditsPerUser, actorIsAdmin ? Number.MAX_SAFE_INTEGER : ORGANIZER_RULE_LIMITS.creditsPerUser))
    : 0;

  let badgeIds = Array.isArray(raw.badgeIds) ? raw.badgeIds : (raw.badgeId ? [raw.badgeId] : []);
  badgeIds = [...new Set(badgeIds.filter(isObjectId))];
  if (!actorIsAdmin && badgeIds.length > ORGANIZER_RULE_LIMITS.badgesPerRule) {
    badgeIds = badgeIds.slice(0, ORGANIZER_RULE_LIMITS.badgesPerRule);
  }

  let maxUses = raw.maxUses === null || raw.maxUses === undefined ? null : Math.floor(Number(raw.maxUses));
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) maxUses = null;
  if (!actorIsAdmin && (maxUses === null || maxUses > ORGANIZER_RULE_LIMITS.maxUses)) {
    maxUses = ORGANIZER_RULE_LIMITS.maxUses;
  }

  let rank = null;
  if (trigger === 'rank') {
    rank = Math.floor(Number(raw.rank));
    if (!Number.isFinite(rank) || rank < 1 || rank > 10000) rank = null;
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : null;

  if (creditsPerUser === 0 && badgeIds.length === 0) {
    throw new RewardError('BAD_REQUEST', 'A rule must grant credits and/or at least one badge.');
  }
  if (trigger === null) {
    throw new RewardError('BAD_REQUEST', 'Trigger must be one of: submission, rank.');
  }
  if (trigger === 'rank' && rank === null) {
    throw new RewardError('BAD_REQUEST', 'Rank rules require a valid positive rank (1 = first place).');
  }

  return { name: name || `${trigger === 'rank' ? `Rank #${rank}` : 'Correct submission'} reward`, trigger, rank, creditsPerUser: safeCredits, badgeIds, maxUses };
}

/**
 * Verify a user is a global admin (ring 0).
 */
async function isGlobalAdmin(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { globalRing: true } });
  return !!user && user.globalRing === 0;
}

/**
 * Verify the funder (rule creator) owns every badge the rule grants.
 * Only relevant for pocket-funded rules; admins mint.
 */
async function assertFunderOwnsBadges(funderId, badgeIds) {
  const owned = await prisma.userBadge.findMany({
    where: { userId: funderId, badgeId: { in: badgeIds } },
    select: { badgeId: true },
  });
  const ownedSet = new Set(owned.map(o => o.badgeId));
  const missing = badgeIds.filter(b => !ownedSet.has(b));
  if (missing.length > 0) {
    throw new RewardError('BADGE_NOT_OWNED', 'You do not own one of the badges this reward grants. Buy it in the store first.');
  }
}

/**
 * Charge the atomic payout for one rule (or ad-hoc manual grant) to every
 * member of a team.
 *
 * @param {object} opts
 * @param {object} opts.rule        rule-like { id, eventId, createdById,
 *                                  trigger, creditsPerUser, badgeIds, maxUses }
 *                                  (id null for ad-hoc manual grants)
 * @param {object} opts.team        { id, members: [{ userId }] }
 * @param {string|null} opts.submissionId  binds the grant to a submission
 * @param {string|null} opts.grantedById   who performed the grant
 * @returns {Promise<{grants: object[], skipped: string|null}>}
 */
async function payoutRule({ rule, team, submissionId = null, grantedById = null }) {
  const memberIds = (team.members || []).map(m => m.userId);
  if (memberIds.length === 0) return { grants: [], skipped: 'empty_team' };

  const creditsPerUser = rule.creditsPerUser || 0;
  const badgeIds = rule.badgeIds || [];
  const totalCredits = creditsPerUser * memberIds.length;
  if (totalCredits === 0 && badgeIds.length === 0) return { grants: [], skipped: 'no_reward' };

  const funder = await prisma.user.findUnique({
    where: { id: rule.createdById },
    select: { id: true, globalRing: true, creditBalance: true },
  });
  if (!funder) throw new RewardError('NOT_FOUND', 'The reward funder no longer exists.');
  const mints = funder.globalRing === 0;

  if (!mints) {
    if (totalCredits > 0 && funder.creditBalance < totalCredits) {
      throw new RewardError(
        'INSUFFICIENT_FUNDS',
        `Not enough credits in your balance to fund this reward. Needed: ${totalCredits}, balance: ${funder.creditBalance}.`
      );
    }
    if (badgeIds.length > 0) await assertFunderOwnsBadges(funder.id, badgeIds);
  }

  let grants = [];
  const skipped = await prisma.$transaction(async (tx) => {
    // Atomic once-per-rule use counter — concurrent payouts cannot double-fire.
    if (rule.id && rule.maxUses !== null && rule.maxUses !== undefined) {
      const claimed = await tx.eventRewardRule.updateMany({
        where: { id: rule.id, uses: { lt: rule.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count === 0) return 'max_uses';
    }

    // Idempotency: never pay the same submission twice for the same rule.
    if (submissionId && rule.id) {
      const dup = await tx.eventRewardGrant.findFirst({
        where: { ruleId: rule.id, submissionId, userId: { in: memberIds } },
        select: { id: true },
      });
      if (dup) return 'already_granted';
    }

    // Pocket funding: atomic debit — the conditional predicate re-reads the
    // balance at write time so two concurrent grants cannot overspend.
    if (totalCredits > 0 && !mints) {
      const debit = await tx.user.updateMany({
        where: { id: funder.id, creditBalance: { gte: totalCredits } },
        data: { creditBalance: { decrement: totalCredits } },
      });
      if (debit.count === 0) return 'insufficient_funds';
    }

    const created = [];
    for (const memberId of memberIds) {
      const grant = await tx.eventRewardGrant.create({
        data: {
          eventId: rule.eventId,
          ruleId: rule.id || null,
          userId: memberId,
          teamId: team.id || null,
          submissionId,
          trigger: rule.trigger,
          credits: creditsPerUser,
          badgeIds,
          grantedById,
        },
      });
      created.push(grant);

      if (creditsPerUser > 0) {
        await tx.user.update({
          where: { id: memberId },
          data: { creditBalance: { increment: creditsPerUser } },
        });
        await tx.transaction.create({
          data: {
            senderId: mints ? null : funder.id,
            receiverId: memberId,
            amount: creditsPerUser,
            type: 'event_reward',
            referenceId: grant.id,
          },
        });
      }

      for (const badgeId of badgeIds) {
        await tx.userBadge.upsert({
          where: { userId_badgeId: { userId: memberId, badgeId } },
          update: {},
          create: { userId: memberId, badgeId, source: 'event' },
        });
      }
    }
    grants = created;
    return null;
  });

  return { grants, skipped };
}

/**
 * List the reward grant ledger for an event (newest first).
 */
async function listGrants(eventId, limit = 200) {
  return prisma.eventRewardGrant.findMany({
    where: { eventId },
    orderBy: { grantedAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, displayName: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
      rule: { select: { id: true, name: true, trigger: true } },
      grantedBy: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
}

module.exports = {
  RewardError,
  payoutRule,
  listGrants,
  sanitizeRuleInput,
  isGlobalAdmin,
  ORGANIZER_RULE_LIMITS,
  MAX_RULES_PER_EVENT,
};