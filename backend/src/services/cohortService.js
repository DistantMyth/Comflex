/**
 * Cohort Tagging Service
 * 
 * Implements admin-controlled email-based auto-tagging.
 * The Admin configures regex patterns via the dashboard;
 * this service applies those patterns to extract cohort years
 * AND branches, then assigns users to groups.
 * Also applies auto-join rules configured by the admin.
 * 
 * See RULES.md §5 for the full tagging specification.
 */

const prisma = require('../prisma');

/**
 * Parse a user's email using the admin-configured parsing rules
 * and assign them to the appropriate cohort groups + auto-join groups.
 * 
 * @param {string} userId - The user's database ID
 * @param {string} email - The user's email address
 * @returns {Promise<string[]>} Array of assigned cohort tag names
 */
async function assignCohortTags(userId, email) {
  // Fetch the institution's email parsing configuration
  const config = await prisma.institutionConfig.findFirst();

  if (!config || !config.isConfigured || !config.emailParsingRules) {
    console.warn('[COHORT] Institution not configured — skipping auto-tagging.');
    return [];
  }

  const rules = config.emailParsingRules;
  const cohortConfig = config.cohortConfig || { seniorOffset: -1, juniorOffset: 1, seniorAutoElevate: true };

  // Apply the regex pattern to extract the year identifier
  let regex;
  try {
    regex = new RegExp(rules.pattern, 'i');
  } catch (err) {
    console.error('[COHORT] Invalid regex pattern in config:', rules.pattern, err.message);
    return [];
  }

  const match = email.match(regex);
  if (!match || !match[rules.captureGroup]) {
    console.warn(`[COHORT] Email "${email}" did not match pattern. No tags assigned.`);
    return [];
  }

  const yearStr = match[rules.captureGroup];
  const year = parseInt(yearStr, 10) + (rules.yearOffset || 0);

  if (isNaN(year)) {
    console.warn(`[COHORT] Extracted year "${yearStr}" is not a valid number.`);
    return [];
  }

  // Extract branch if configured
  let branch = null;
  let branchLabel = null;
  if (rules.branchCaptureGroup !== undefined && match[rules.branchCaptureGroup]) {
    branch = match[rules.branchCaptureGroup].toLowerCase();
    branchLabel = rules.branchMapping?.[branch] || branch;
    console.log(`[COHORT] Extracted branch: ${branch} → ${branchLabel}`);
  }

  // Determine the group names
  const primaryName = `cohort-${year}`;
  const seniorYear = year + cohortConfig.seniorOffset; // e.g., 27 for year 28
  const juniorYear = year + cohortConfig.juniorOffset; // e.g., 29 for year 28

  // Cross-year group names — always use the canonical form (lower-higher)
  const crossSeniorName = `cohort-${Math.min(year, seniorYear)}-${Math.max(year, seniorYear)}`;
  const crossJuniorName = `cohort-${Math.min(year, juniorYear)}-${Math.max(year, juniorYear)}`;

  const tags = [primaryName, crossSeniorName, crossJuniorName];

  // Add branch tag if extracted
  if (branch) {
    tags.push(`branch-${branch}`);
  }

  // Create groups if they don't exist and add the user as a member
  for (const tagName of [primaryName, crossSeniorName, crossJuniorName]) {
    // Determine group type
    const isPrimary = tagName === primaryName;
    const type = isPrimary ? 'primary' : 'cross-year';

    // Upsert the group (also fixes display names on existing groups)
    const correctDisplayName = isPrimary
      ? `Class of ${year}`
      : `${tagName.split('-')[1]}-${tagName.split('-')[2]} Cross-Year`;

    let group = await prisma.cohortGroup.findUnique({ where: { name: tagName } });
    if (!group) {
      group = await prisma.cohortGroup.create({
        data: {
          name: tagName,
          displayName: correctDisplayName,
          type,
        },
      });
    } else if (group.displayName !== correctDisplayName) {
      // Fix existing group display name if it's wrong
      group = await prisma.cohortGroup.update({
        where: { id: group.id },
        data: { displayName: correctDisplayName },
      });
    }

    // Determine the user's ring in this group:
    // - Primary group → Ring 3 (member)
    // - Cross-year where user is the SENIOR cohort → Ring 2 (auto-elevated)
    // - Cross-year where user is the JUNIOR cohort → Ring 3 (member)
    let groupRing = 3;
    if (!isPrimary && cohortConfig.seniorAutoElevate) {
      if (tagName === crossJuniorName) {
        // We are the senior in the junior cross-year group
        groupRing = 2;
      }
    }

    // Default permissions for Ring 2 (elevated/seniors)
    const defaultPermissions = groupRing === 2
      ? {
        can_send_messages: true,
        can_delete_own_messages: true,
        can_delete_others_messages: true,
        can_mute_members: true,
        can_kick_members: true,
        can_add_members: true,
        can_tag_members: true,
        can_manage_economy: false,
        can_create_events: false,
        can_pin_messages: true,
        can_manage_roles: false,
        can_edit_group_info: false,
        can_stop_others_tagging: true,
      }
      : {
        can_send_messages: true,
        can_delete_own_messages: true,
        can_delete_others_messages: false,
        can_mute_members: false,
        can_kick_members: false,
        can_add_members: false,
        can_tag_members: true,
        can_manage_economy: false,
        can_create_events: false,
        can_pin_messages: false,
        can_manage_roles: false,
        can_edit_group_info: false,
        can_stop_others_tagging: false,
      };

    // Create group membership (skip if already exists)
    const existingMembership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId: group.id } },
    });

    if (!existingMembership) {
      await prisma.groupMember.create({
        data: {
          userId,
          groupId: group.id,
          ring: groupRing,
          permissions: defaultPermissions,
        },
      });
    }
  }

  // ── Auto-Join Rules ──
  // Apply admin-configured auto-join rules based on year and/or branch
  const fullYear = year < 100 ? 2000 + year : year;
  const shortYear = String(fullYear % 100).padStart(2, '0');
  const strFullYear = String(fullYear);

  const autoJoinRules = config.autoJoinRules || [];
  for (const rule of autoJoinRules) {
    let matches = false;
    const mv = String(rule.matchValue || '').trim().toLowerCase();
    if (rule.matchField === 'year') {
      matches = mv === shortYear || mv === strFullYear;
    } else if (rule.matchField === 'branch' && branch) {
      matches = mv === branch;
    } else if (rule.matchField === 'both' && branch) {
      matches = mv === `${shortYear}-${branch}` || mv === `${strFullYear}-${branch}`;
    }

    if (matches && rule.groupId) {
      const group = await prisma.cohortGroup.findUnique({ where: { id: rule.groupId } });
      if (group) {
        const existingMembership = await prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId: group.id } },
        });
        if (!existingMembership) {
          await prisma.groupMember.create({
            data: {
              userId,
              groupId: group.id,
              ring: 3, // Default: Member
              permissions: { can_send_messages: true, can_view_history: true },
            },
          });
        }
      }
    }
  }

  // Update user's cohortTags in database
  await prisma.user.update({
    where: { id: userId },
    data: { cohortTags: tags },
  });

  console.log(`[COHORT] ✅ Tagged user ${email}: ${tags.join(', ')}`);
  return tags;
}

/**
 * Re-tag a user: remove their existing cohort memberships and re-apply
 * the current parsing rules. Preserves custom groups.
 */
async function retagUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  // Remove ONLY primary & cross-year cohort-related group memberships (preserve custom groups)
  const cohortGroups = await prisma.cohortGroup.findMany({
    where: { type: { in: ['primary', 'cross-year'] } },
    select: { id: true },
  });
  const cohortGroupIds = cohortGroups.map((g) => g.id);

  if (cohortGroupIds.length > 0) {
    await prisma.groupMember.deleteMany({
      where: { userId, groupId: { in: cohortGroupIds } },
    });
  }

  // Re-assign based on current rules
  return assignCohortTags(userId, user.email);
}

/**
 * Extract the numeric year from cohort tags (e.g., 'cohort-2028' -> 2028)
 */
function extractCohortYear(cohortTags) {
  if (!cohortTags || !Array.isArray(cohortTags)) return null;
  for (const tag of cohortTags) {
    if (tag.startsWith('cohort-') && !tag.includes('-', 7)) {
      const year = parseInt(tag.split('-')[1], 10);
      if (!isNaN(year)) return year;
    }
  }
  return null;
}

/**
 * Extract the branch code from cohort tags (e.g., 'branch-cs' -> 'cs')
 */
function extractBranch(cohortTags) {
  if (!cohortTags || !Array.isArray(cohortTags)) return null;
  for (const tag of cohortTags) {
    if (tag.startsWith('branch-')) {
      return tag.substring(7);
    }
  }
  return null;
}

module.exports = { assignCohortTags, retagUser, extractCohortYear, extractBranch };
