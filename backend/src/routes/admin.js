/**
 * Admin Routes — /api/v1/admin/*
 * 
 * All routes require Ring 0 (Admin) unless otherwise specified.
 * Handles: institution config, cohort config, auto-join rules,
 * branch detection, user management, permissions.
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const { requireRing, validateElevation } = require('../middleware/ringCheck');
const userService = require('../services/userService');
const { retagUser } = require('../services/cohortService');
const prisma = require('../prisma');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

// All admin routes require authentication + Ring 0
router.use(authMiddleware, requireRing(0));

// Reject malformed ObjectIds cleanly instead of leaking P2023 → 500
const ID_RE = /^[0-9a-fA-F]{24}$/;
router.param('id', (req, res, next, id) => {
  if (!ID_RE.test(id)) {
    return error(res, 'VALIDATION_ERROR', 'Invalid id.', 400);
  }
  next();
});

// Strict boolean coercion — plain Boolean('false') === true is a footgun.
const toBool = (v) => {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return undefined; // invalid
};

// ============================================================
// INSTITUTION CONFIG
// ============================================================

/**
 * POST /api/v1/admin/institution/setup
 * Initial institution configuration (first-boot wizard).
 */
router.post(
  '/institution/setup',
  [
    body('name').trim().notEmpty().withMessage('Institution name is required.'),
    body('domain').trim().notEmpty().withMessage('Domain is required.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const config = await prisma.institutionConfig.findFirst();
      if (!config) {
        return error(res, 'CONFIG_MISSING', 'InstitutionConfig not found. Run seed first.', 500);
      }

      const updated = await prisma.institutionConfig.update({
        where: { id: config.id },
        data: {
          name: req.body.name,
          domain: req.body.domain,
          logoUrl: req.body.logoUrl || null,
          isConfigured: true,
        },
      });

      return success(res, updated, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/admin/institution
 * Retrieve current institution settings.
 */
router.get('/institution', async (req, res, next) => {
  try {
    const config = await prisma.institutionConfig.findFirst();
    return success(res, config);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/admin/institution
 * Update institution settings.
 */
router.patch(
  '/institution',
  [
    body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters.'),
    body('domain').optional().trim().notEmpty().withMessage('Domain cannot be empty.'),
    body('logoUrl').optional({ nullable: true }).isString().withMessage('logoUrl must be a string.'),
    body('defaultCredits').optional().isInt({ min: 0, max: 1000000 }).withMessage('defaultCredits must be a positive integer.'),
    body('notesDownloadReward').optional().isInt({ min: 0, max: 100000 }).withMessage('notesDownloadReward must be a positive integer.'),
    body('creditConfig').optional().isObject().withMessage('creditConfig must be an object.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const config = await prisma.institutionConfig.findFirst();
      if (!config) return error(res, 'CONFIG_MISSING', 'InstitutionConfig not found.', 500);

      const allowed = {};
      if (req.body.name !== undefined) allowed.name = req.body.name;
      if (req.body.domain !== undefined) allowed.domain = req.body.domain;
      if (req.body.logoUrl !== undefined) allowed.logoUrl = req.body.logoUrl;
      if (req.body.defaultCredits !== undefined) allowed.defaultCredits = parseInt(req.body.defaultCredits, 10);
      if (req.body.notesDownloadReward !== undefined) allowed.notesDownloadReward = parseInt(req.body.notesDownloadReward, 10);
      if (req.body.creditConfig !== undefined) allowed.creditConfig = req.body.creditConfig;

      const updated = await prisma.institutionConfig.update({
        where: { id: config.id },
        data: allowed,
      });

      return success(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// COHORT CONFIG (EMAIL PARSING RULES + BRANCH DETECTION)
// ============================================================

/**
 * GET /api/v1/admin/cohort-config
 * Retrieve current email parsing rules.
 */
router.get('/cohort-config', async (req, res, next) => {
  try {
    const config = await prisma.institutionConfig.findFirst();
    return success(res, {
      emailParsingRules: config?.emailParsingRules || null,
      cohortConfig: config?.cohortConfig || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/admin/cohort-config
 * Update email parsing regex / domain rules (including branch detection).
 *
 * emailParsingRules format:
 * {
 *   pattern: "^l(cs|ci|cb)(\\d{4})(\\d{3,})@iiitl\\.ac\\.in$",
 *   captureGroup: 2,           // year capture group index
 *   branchCaptureGroup: 1,     // branch capture group index (optional)
 *   branchMapping: { cs: "Computer Science", ci: "AI", cb: "CS-Business" },
 *   yearOffset: 0
 * }
 */
router.put(
  '/cohort-config',
  [
    body('emailParsingRules').isObject().withMessage('emailParsingRules must be an object.'),
    body('emailParsingRules.pattern').isString().withMessage('Pattern is required.'),
    body('emailParsingRules.captureGroup').isInt({ min: 0 }).withMessage('captureGroup must be a non-negative integer.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      // Validate the regex pattern is valid
      try {
        new RegExp(req.body.emailParsingRules.pattern);
      } catch {
        return error(res, 'INVALID_REGEX', 'The provided regex pattern is invalid.', 400);
      }

      const config = await prisma.institutionConfig.findFirst();
      if (!config) return error(res, 'CONFIG_MISSING', 'InstitutionConfig not found.', 500);

      const updated = await prisma.institutionConfig.update({
        where: { id: config.id },
        data: {
          emailParsingRules: req.body.emailParsingRules,
          cohortConfig: req.body.cohortConfig || config.cohortConfig || {
            seniorOffset: -1,
            juniorOffset: 1,
            seniorAutoElevate: true,
          },
          isConfigured: true,
        },
      });

      return success(res, {
        emailParsingRules: updated.emailParsingRules,
        cohortConfig: updated.cohortConfig,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/admin/cohort-config/preview
 * Test a regex against a sample email (dry run) — includes branch extraction.
 */
router.post(
  '/cohort-config/preview',
  [
    body('email').isEmail().withMessage('A valid test email is required.'),
    body('pattern').isString().withMessage('Pattern is required.'),
    body('captureGroup').custom((val) => {
      const n = Number(val);
      if (isNaN(n) || n < 0 || !Number.isInteger(n)) throw new Error('captureGroup must be a non-negative integer.');
      return true;
    }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const { email, pattern, yearOffset = 0, branchCaptureGroup, branchMapping } = req.body;
      const captureGroup = Number(req.body.captureGroup);

      let regex;
      try {
        regex = new RegExp(pattern, 'i');
      } catch {
        return error(res, 'INVALID_REGEX', 'The provided regex pattern is invalid.', 400);
      }

      const match = email.match(regex);
      if (!match || !match[captureGroup]) {
        return success(res, {
          matched: false,
          extractedYear: null,
          extractedBranch: null,
          predictedTags: [],
          message: `Email did not match the pattern (or capture group ${captureGroup} not found). Match groups: ${match ? match.length - 1 : 0}`,
        });
      }

      const yearRaw = parseInt(match[captureGroup], 10);
      if (isNaN(yearRaw)) {
        return success(res, {
          matched: true,
          extractedYear: null,
          extractedBranch: null,
          predictedTags: [],
          message: `Capture group ${captureGroup} matched "${match[captureGroup]}" which is not a number. Check your capture group index.`,
        });
      }
      const year = yearRaw + yearOffset;
      const primaryName = `cohort-${year}`;
      const crossSenior = `cohort-${Math.min(year, year - 1)}-${Math.max(year, year - 1)}`;
      const crossJunior = `cohort-${Math.min(year, year + 1)}-${Math.max(year, year + 1)}`;

      const predictedTags = [primaryName, crossSenior, crossJunior];

      // Extract branch if configured
      let extractedBranch = null;
      let branchLabel = null;
      const bcg = branchCaptureGroup !== undefined && branchCaptureGroup !== null && branchCaptureGroup !== ''
        ? parseInt(branchCaptureGroup, 10) : null;
      if (bcg !== null && !isNaN(bcg) && match[bcg]) {
        extractedBranch = match[bcg].toLowerCase();
        branchLabel = branchMapping?.[extractedBranch] || extractedBranch;
        predictedTags.push(`branch-${extractedBranch}`);
      }

      return success(res, {
        matched: true,
        extractedYear: year,
        extractedBranch: branchLabel || extractedBranch,
        extractedBranchCode: extractedBranch,
        predictedTags,
        message: `Extracted year: ${year}${extractedBranch ? `, branch: ${branchLabel || extractedBranch}` : ''}`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// ADMIN GROUP MANAGEMENT
// ============================================================

/**
 * GET /api/v1/admin/groups
 * List ALL groups on the platform with member counts (admin only).
 */
router.get('/groups', async (req, res, next) => {
  try {
    const groups = await prisma.cohortGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, groups.map(g => ({
      ...g,
      memberCount: g._count.members,
    })));
  } catch (err) {
    next(err);
  }
});

// ============================================================
// AUTO-JOIN RULES
// ============================================================

/**
 * GET /api/v1/admin/auto-join-rules
 * Get the current auto-join rules.
 */
router.get('/auto-join-rules', async (req, res, next) => {
  try {
    const config = await prisma.institutionConfig.findFirst();
    return success(res, { autoJoinRules: config?.autoJoinRules || [] });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/admin/auto-join-rules
 * Set auto-join rules.
 *
 * Rules format: [{ matchField: "year"|"branch"|"both", matchValue: "2028"|"cs"|"2028-cs", groupId: "..." }]
 */
router.put(
  '/auto-join-rules',
  [body('rules').isArray().withMessage('rules must be an array.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      // Validate each rule
      for (const rule of req.body.rules) {
        if (!['year', 'branch', 'both'].includes(rule.matchField)) {
          return error(res, 'VALIDATION_ERROR', `matchField must be "year", "branch", or "both". Got: "${rule.matchField}"`, 400);
        }
        if (!rule.matchValue) {
          return error(res, 'VALIDATION_ERROR', 'matchValue is required for each rule.', 400);
        }
        if (!rule.groupId || !ID_RE.test(rule.groupId)) {
          return error(res, 'VALIDATION_ERROR', 'A valid groupId is required for each rule.', 400);
        }
        // Verify the group exists
        const group = await prisma.cohortGroup.findUnique({ where: { id: rule.groupId } });
        if (!group) {
          return error(res, 'GROUP_NOT_FOUND', `Group "${rule.groupId}" not found.`, 404);
        }
      }

      const config = await prisma.institutionConfig.findFirst();
      if (!config) return error(res, 'CONFIG_MISSING', 'InstitutionConfig not found.', 500);

      const updated = await prisma.institutionConfig.update({
        where: { id: config.id },
        data: { autoJoinRules: req.body.rules },
      });

      return success(res, { autoJoinRules: updated.autoJoinRules });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/admin/auto-join-rules/preview
 * Test which groups a sample email would auto-join.
 */
router.post(
  '/auto-join-rules/preview',
  [body('email').isEmail().withMessage('A valid test email is required.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const config = await prisma.institutionConfig.findFirst();
      if (!config || !config.emailParsingRules) {
        return success(res, { autoJoinGroups: [], message: 'No email parsing rules configured.' });
      }

      const rules = config.emailParsingRules;
      let regex;
      try {
        regex = new RegExp(rules.pattern, 'i');
      } catch {
        return error(res, 'INVALID_REGEX', 'Configured regex is invalid.', 500);
      }

      const match = req.body.email.match(regex);
      if (!match) {
        return success(res, { extractedYear: null, extractedBranch: null, autoJoinGroups: [], message: 'Email did not match the pattern.' });
      }

      const cg = parseInt(rules.captureGroup, 10);
      const yearRaw = !isNaN(cg) && match[cg] ? parseInt(match[cg], 10) : null;
      const year = yearRaw !== null && !isNaN(yearRaw) ? yearRaw + (rules.yearOffset || 0) : null;

      const bcg = rules.branchCaptureGroup !== undefined && rules.branchCaptureGroup !== null
        ? parseInt(rules.branchCaptureGroup, 10) : null;
      const branch = bcg !== null && !isNaN(bcg) && match[bcg]
        ? match[bcg].toLowerCase()
        : null;

      const autoJoinRules = config.autoJoinRules || [];
      const matchingGroups = [];

      for (const rule of autoJoinRules) {
        let matches = false;
        if (rule.matchField === 'year' && year !== null) {
          const y2 = String(year % 100); // "29" from 2029
          const y4 = String(year);       // "2029"
          matches = rule.matchValue === y2 || rule.matchValue === y4;
        } else if (rule.matchField === 'branch' && branch) {
          matches = rule.matchValue.toLowerCase() === branch;
        } else if (rule.matchField === 'both' && year !== null && branch) {
          const y2 = String(year % 100);
          const y4 = String(year);
          const mv = rule.matchValue.toLowerCase();
          matches = mv === `${y2}-${branch}` || mv === `${y4}-${branch}`;
        }

        if (matches) {
          const group = await prisma.cohortGroup.findUnique({ where: { id: rule.groupId } });
          if (group) {
            matchingGroups.push({ groupId: group.id, groupName: group.name, displayName: group.displayName, rule });
          }
        }
      }

      return success(res, {
        extractedYear: year,
        extractedBranch: branch,
        autoJoinGroups: matchingGroups,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// USER MANAGEMENT
// ============================================================

/**
 * GET /api/v1/admin/users
 * List all users with search/filter.
 */
router.get('/users', async (req, res, next) => {
  try {
    const { search, ring, page, limit } = req.query;
    const result = await userService.listUsers({
      search,
      ring,
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
    });
    return success(res, result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/users/:id
 * Retrieve any user's profile.
 */
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    return success(res, user);
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

/**
 * PATCH /api/v1/admin/users/:id/ring
 * Change a user's global ring level.
 */
router.patch(
  '/users/:id/ring',
  [body('ring').isInt({ min: 0 }).withMessage('Ring must be a non-negative integer.')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      // Get the target user's current ring
      const targetUser = await userService.getUserById(req.params.id);

      // Validate the elevation/de-elevation
      const validation = validateElevation(
        req.user.globalRing,
        targetUser.globalRing,
        req.body.ring,
        req.user.id,
        req.params.id
      );

      if (!validation.valid) {
        return error(res, 'RING_VIOLATION', validation.reason, 403);
      }

      const user = await userService.setUserRing(req.params.id, req.body.ring);
      return success(res, user);
    } catch (err) {
      if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
      next(err);
    }
  }
);

/**
 * POST /api/v1/admin/users/create-test
 * Create a test user directly (bypasses registration gate).
 * Useful for testing cohort rules and group functionality.
 */
router.post(
  '/users/create-test',
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('displayName').trim().notEmpty().withMessage('Display name is required.'),
    body('password').optional().isLength({ min: 4 }).withMessage('Password must be at least 4 characters.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
          errors.array().map(e => ({ field: e.path, issue: e.msg }))
        );
      }

      const { email, displayName, password = 'test123' } = req.body;

      // Check for duplicate email
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return error(res, 'DUPLICATE_EMAIL', 'A user with this email already exists.', 409);
      }

      // Auto-generate a dummy username to avoid MongoDB multiple-null unique constraint error
      const rawBase = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      const baseUsername = `user_${(rawBase || 'member').slice(0, 15)}`;
      let generatedUsername = baseUsername;
      let counter = 1;
      while (await prisma.user.findFirst({ where: { username: { equals: generatedUsername, mode: 'insensitive' } } })) {
        generatedUsername = `${baseUsername}_${counter}`;
        counter++;
      }

      // Hash the password
      const { hashPassword } = require('../utils/password');
      const hashedPw = await hashPassword(password);

      // Create the user
      const config = await prisma.institutionConfig.findFirst();
      const user = await prisma.user.create({
        data: {
          email,
          username: generatedUsername,
          password: hashedPw,
          displayName,
          globalRing: 3,
          hasPassword: true,
          cohortTags: [],
          displayBadges: [],
          creditBalance: config?.defaultCredits ?? 0,
        },
      });

      // Auto-assign cohort tags
      const { assignCohortTags } = require('../services/cohortService');
      const tags = await assignCohortTags(user.id, email);

      // Fetch updated user
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });

      return success(res, {
        id: updatedUser.id,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        globalRing: updatedUser.globalRing,
        cohortTags: updatedUser.cohortTags,
        message: `Test user created. Tags: ${tags.join(', ') || 'none'}`,
      }, 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/admin/users/retag-all
 * Re-process ALL users through current cohort + auto-join rules.
 * Useful after changing auto-join config to apply to existing users.
 */
router.post('/users/retag-all', async (req, res, next) => {
  try {
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true },
    });

    let processed = 0;
    let failed = 0;
    for (const u of allUsers) {
      try {
        await retagUser(u.id);
        processed++;
      } catch {
        failed++;
      }
    }

    return success(res, {
      message: `Re-tagged ${processed} users. ${failed > 0 ? `${failed} failed.` : ''}`,
      processed,
      failed,
      total: allUsers.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/users/:id/retag
 * Re-process a user's email and reassign cohort tags.
 */
router.post('/users/:id/retag', async (req, res, next) => {
  try {
    const tags = await retagUser(req.params.id);
    return success(res, { cohortTags: tags, message: 'User re-tagged successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/admin/users/:id/permissions
 * Update admin-delegated permissions for a user (e.g., canCreateGroups).
 */
router.patch(
  '/users/:id/permissions',
  async (req, res, next) => {
    try {
      const userId = req.params.id;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return error(res, 'USER_NOT_FOUND', 'User not found.', 404);
      }

      const updateData = {};
      const boolFields = ['canCreateGroups', 'canCreateEvents', 'canManageResources', 'canManageStore'];
      for (const field of boolFields) {
        if (req.body[field] !== undefined) {
          const val = toBool(req.body[field]);
          if (val === undefined) {
            return error(res, 'VALIDATION_ERROR', `${field} must be true or false.`, 400);
          }
          updateData[field] = val;
        }
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      return success(res, {
        id: updated.id,
        canCreateGroups: updated.canCreateGroups,
        canCreateEvents: updated.canCreateEvents,
        canManageResources: updated.canManageResources,
        canManageStore: updated.canManageStore,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/admin/users/:id
 * Permanently delete a user and all associated data.
 * Cannot delete yourself.
 */
router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Prevent self-deletion
    if (userId === req.user.id) {
      return error(res, 'SELF_DELETE', 'You cannot delete your own account.', 400);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return error(res, 'USER_NOT_FOUND', 'User not found.', 404);
    }

    // Cannot delete another admin directly without demoting first
    if (user.globalRing === 0 && userId !== req.user.id) {
      return error(res, 'ADMIN_DELETE', 'Cannot delete another admin. Demote them first.', 403);
    }

    // Delete all associated data in correct dependency order
    await prisma.$transaction([
      prisma.groupMember.deleteMany({ where: { userId } }),
      prisma.groupInvite.deleteMany({ where: { OR: [{ userId }, { invitedBy: userId }] } }),
      prisma.eventTeamInvite.deleteMany({ where: { OR: [{ invitedUserId: userId }, { invitedBy: userId }] } }),
      prisma.eventTeamMember.deleteMany({ where: { userId } }),
      prisma.eventOrganizer.deleteMany({ where: { userId } }),
      prisma.eventSubmission.updateMany({ where: { evaluatedById: userId }, data: { evaluatedById: null } }),
      prisma.teamPointAdjustment.deleteMany({ where: { awardedById: userId } }),
      prisma.eventRewardGrant.deleteMany({ where: { userId } }),
      prisma.event.deleteMany({ where: { creatorId: userId } }),
      prisma.message.deleteMany({ where: { authorId: userId } }),
      prisma.directMessage.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
      prisma.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      prisma.muteRecord.deleteMany({ where: { userId } }),
      prisma.userBadge.deleteMany({ where: { userId } }),
      prisma.transaction.deleteMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
      prisma.resource.deleteMany({ where: { uploaderId: userId } }),
      prisma.chatbotNote.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.anonGroupJoin.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    return success(res, { message: `User "${user.displayName}" deleted.` });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DATABASE & SYSTEM DIAGNOSTICS
// ============================================================

/**
 * GET /api/v1/admin/system/diagnostics
 * Telemetry and system statistics.
 */
router.get('/system/diagnostics', async (req, res, next) => {
  try {
    const [userCount, groupCount, msgCount, eventCount, resourceCount, txCount] = await Promise.all([
      prisma.user.count(),
      prisma.cohortGroup.count(),
      prisma.message.count(),
      prisma.event.count(),
      prisma.resource.count(),
      prisma.transaction.count(),
    ]);

    const memory = process.memoryUsage();
    const { isCloudinaryConfigured } = require('../utils/fileStorage');
    return success(res, {
      status: 'healthy',
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
      storageProvider: isCloudinaryConfigured() ? 'cloudinary' : 'local_ephemeral',
      memoryUsage: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
      counts: {
        users: userCount,
        groups: groupCount,
        messages: msgCount,
        events: eventCount,
        resources: resourceCount,
        transactions: txCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/database/backup
 * Download a full JSON dump of the database.
 */
router.get('/database/backup', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany();
    // Strip credential material from the dump
    const sanitizedUsers = users.map((u) => {
      const {
        password, refreshToken, resetToken, resetTokenExpiry,
        emailVerifyToken, emailVerifyExpiry, ...safe
      } = u;
      return safe;
    });

    const backup = {
      timestamp: new Date().toISOString(),
      institutionConfig: await prisma.institutionConfig.findMany(),
      users: sanitizedUsers,
      cohortGroups: await prisma.cohortGroup.findMany(),
      groupMembers: await prisma.groupMember.findMany(),
      groupInvites: await prisma.groupInvite.findMany(),
      messages: await prisma.message.findMany(),
      muteRecords: await prisma.muteRecord.findMany(),
      friendships: await prisma.friendship.findMany(),
      directMessages: await prisma.directMessage.findMany(),
      events: await prisma.event.findMany(),
      eventOrganizers: await prisma.eventOrganizer.findMany(),
      eventTeams: await prisma.eventTeam.findMany(),
      eventTeamMembers: await prisma.eventTeamMember.findMany(),
      eventTeamInvites: await prisma.eventTeamInvite.findMany(),
      badges: await prisma.badge.findMany(),
      storeListings: await prisma.storeListing.findMany(),
      resourceSubjects: await prisma.resourceSubject.findMany(),
      resources: await prisma.resource.findMany(),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="comflex-backup.json"');
    return res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/admin/database/clear
 * Danger zone: Delete all data except InstitutionConfig and the calling Admin User.
 * Requires admin password verification.
 */
router.delete('/database/clear', async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const { adminPassword } = req.body;
    if (!adminPassword) {
      return error(res, 'AUTH_REQUIRED', 'Admin password is required to clear the database.', 400);
    }

    const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
    if (!adminUser || !adminUser.password) {
      return error(res, 'AUTH_REQUIRED', 'Password verification failed.', 403);
    }

    const { verifyPassword } = require('../utils/password');
    const validPw = await verifyPassword(adminPassword, adminUser.password);
    if (!validPw) {
      return error(res, 'INVALID_CREDENTIALS', 'Incorrect admin password.', 403);
    }

    // Complete cleanup of all data models
    await prisma.$transaction([
      prisma.anonReport.deleteMany(),
      prisma.anonGroupJoin.deleteMany(),
      prisma.teamPointAdjustment.deleteMany(),
      prisma.eventSubmission.deleteMany(),
      prisma.eventTeamInvite.deleteMany(),
      prisma.eventTeamMember.deleteMany(),
      prisma.eventTeam.deleteMany(),
      prisma.eventOrganizer.deleteMany(),
      prisma.eventTask.deleteMany(),
      prisma.eventRewardGrant.deleteMany(),
      prisma.eventRewardRule.deleteMany(),
      prisma.event.deleteMany(),
      prisma.directMessage.deleteMany(),
      prisma.friendship.deleteMany(),
      prisma.muteRecord.deleteMany(),
      prisma.message.deleteMany(),
      prisma.groupInvite.deleteMany(),
      prisma.groupMember.deleteMany(),
      prisma.cohortGroup.deleteMany(),
      prisma.storeListing.deleteMany(),
      prisma.badge.deleteMany(),
      prisma.resource.deleteMany(),
      prisma.resourceSubject.deleteMany(),
      prisma.chatbotNote.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.transaction.deleteMany(),
      prisma.userBadge.deleteMany(),
      prisma.user.deleteMany({ where: { id: { not: adminId } } }),
    ]);

    return success(res, { message: 'Database successfully cleared. Admin session preserved.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
