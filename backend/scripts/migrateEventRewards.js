/**
 * One-time migration: convert legacy rewardBudget / rewardTiers JSON blobs
 * (pre-redesign) into structured EventRewardRule rows.
 *
 *   rewardBudget -> one "submission" rule (per correct answer, funded by the
 *                   event creator under the new pocket rules)
 *   rewardTiers  -> one "rank" rule per tier
 *
 * Run: node scripts/migrateEventRewards.js
 */

require('dotenv').config();
const prisma = require('../src/prisma');

async function main() {
  // Legacy rewardBudget / rewardTiers blobs still sit on the Event documents
  // (db push removed them from the schema, not the data) — read them raw.
  const res = await prisma.$runCommandRaw({
    find: 'Event',
    filter: {},
    projection: { _id: 1, creatorId: 1, rewardBudget: 1, rewardTiers: 1 },
  });
  const events = (res.cursor && res.cursor.firstBatch) || [];

  let rulesCreated = 0;
  let eventsVisited = 0;

  for (const rawEvent of events) {
    const event = {
      id: String(rawEvent._id),
      creatorId: String(rawEvent.creatorId),
      rewardBudget: rawEvent.rewardBudget,
      rewardTiers: rawEvent.rewardTiers,
    };
    const budget = event.rewardBudget;
    const tiers = event.rewardTiers;
    if (!budget && !tiers) continue;

    eventsVisited += 1;

    if (budget && typeof budget === 'object') {
      const creditsPerCorrect = Number(budget.creditsPerCorrect) || 0;
      const badgesPerCorrect = Number(budget.badgesPerCorrect) || 0;
      let maxUses = null;
      if (budget.maxCredits && creditsPerCorrect > 0) {
        maxUses = Math.floor(Number(budget.maxCredits) / creditsPerCorrect);
      } else if (budget.maxBadges && badgesPerCorrect > 0) {
        maxUses = Math.floor(Number(budget.maxBadges) / badgesPerCorrect);
      }
      await prisma.eventRewardRule.create({
        data: {
          eventId: event.id,
          name: 'Auto reward (per correct answer)',
          trigger: 'submission',
          creditsPerUser: creditsPerCorrect,
          badgeIds: budget.badgeId ? [budget.badgeId] : [],
          maxUses,
          enabled: true,
          createdById: event.creatorId,
        },
      });
      rulesCreated += 1;
      console.log(`event ${event.id}: converted rewardBudget -> submission rule (${creditsPerCorrect}cr/user, maxUses=${maxUses})`);
    }

    if (Array.isArray(tiers)) {
      for (const tier of tiers) {
        const rank = Math.floor(Number(tier.rank));
        if (!Number.isFinite(rank) || rank < 1) continue;
        await prisma.eventRewardRule.create({
          data: {
            eventId: event.id,
            name: `Rank #${rank} reward`,
            trigger: 'rank',
            rank,
            creditsPerUser: Math.max(0, Math.floor(Number(tier.credits)) || 0),
            badgeIds: tier.badgeId ? [tier.badgeId] : [],
            maxUses: 1,
            enabled: true,
            createdById: event.creatorId,
          },
        });
        rulesCreated += 1;
        console.log(`event ${event.id}: converted rewardTiers -> rank #${rank} rule`);
      }
    }
  }

  console.log(`Done. Visited ${eventsVisited} event(s), created ${rulesCreated} reward rule(s).`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());