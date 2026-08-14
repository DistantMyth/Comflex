const express = require('express');
const { body, param, validationResult } = require('express-validator');
const eventController = require('../controllers/eventController');
const authMiddleware = require('../middleware/auth');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Middleware to validate request
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, 'VALIDATION_ERROR', 'Invalid input.', 400,
      errors.array().map(e => ({ field: e.path, issue: e.msg }))
    );
  }
  next();
};

/**
 * GET /api/v1/events
 * List targeted and public upcoming events.
 */
router.get('/', eventController.listEvents);

/**
 * GET /api/v1/events/manage
 * List events the user is an organizer of.
 */
router.get('/manage', eventController.listManagedEvents);

/**
 * GET /api/v1/events/invite/:token
 * Resolve an event invite link (auth required) — returns event info and
 * whether the current user is eligible to join.
 */
router.get('/invite/:token',
  [param('token').isString().withMessage('Invalid invite token.')],
  validate,
  eventController.getEventInviteInfo
);

/**
 * POST /api/v1/events/invite/:token/join
 * Join an event via its invite link. Whitelist/blacklist still applies.
 */
router.post('/invite/:token/join',
  [param('token').isString().withMessage('Invalid invite token.')],
  validate,
  eventController.joinEventViaInvite
);

/**
 * POST /api/v1/events/:id/invite-link
 * Organizer: create/rotate a shareable invite link (expires in 7 days).
 */
router.post('/:id/invite-link',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.generateEventInviteLink
);

/**
 * GET /api/v1/events/:id
 * Get full event details.
 */
router.get('/:id',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.getEvent
);

/**
 * POST /api/v1/events
 * Create a new main event or sub-event.
 */
router.post('/',
  [
    body('title').trim().notEmpty().withMessage('Title is required.'),
    body('startDate').isISO8601().toDate().withMessage('A valid start date is required.'),
    body('category').trim().notEmpty().withMessage('Category is required.'),
    body('durationHours').optional().isInt({ min: 0 }).withMessage('Must be non-negative integer.'),
    body('durationMinutes').optional().isInt({ min: 0, max: 59 }).withMessage('Must be 0-59.'),
  ],
  validate,
  eventController.createEvent
);

/**
 * PATCH /api/v1/events/:id
 * Update an event.
 */
router.patch('/:id',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.updateEvent
);

/**
 * DELETE /api/v1/events/:id
 * Cancel/delete an event.
 */
router.delete('/:id',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.deleteEvent
);

// ==========================================
// ORGANIZERS
// ==========================================

/**
 * POST /api/v1/events/:id/organizers
 * Add or update an organizer with granular permissions.
 */
router.post('/:id/organizers',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    body('userId').isMongoId().withMessage('User ID is required.'),
    body('permissions').isObject().withMessage('Permissions must be an object.')
  ],
  validate,
  eventController.addOrUpdateOrganizer
);

/**
 * POST /api/v1/events/:id/teams
 * Create a team for an event.
 */
router.post('/:id/teams',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    body('name').trim().notEmpty().withMessage('Team name is required.')
  ],
  validate,
  eventController.createTeam
);

/**
 * POST /api/v1/events/:id/teams/:teamId/register
 * Register a formed team for an event.
 */
router.post('/:id/teams/:teamId/register',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.')
  ],
  validate,
  eventController.registerTeam
);

/**
 * GET /api/v1/events/:id/teams
 * List teams for an event.
 */
router.get('/:id/teams',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.listTeams
);

/**
 * POST /api/v1/events/:id/teams/:teamId/invites
 * (Legacy/Admin) Invite a user directly via DM (optional retaining).
 */
router.post('/:id/teams/:teamId/invites',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.'),
    body('userId').isMongoId().withMessage('User ID is required to invite.')
  ],
  validate,
  eventController.inviteToTeam
);

/**
 * POST /api/v1/events/:id/teams/invites/:inviteId/accept
 */
router.post('/:id/teams/invites/:inviteId/accept',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('inviteId').isMongoId().withMessage('Invalid Invite ID.')
  ],
  validate,
  eventController.acceptTeamInvite
);

/**
 * POST /api/v1/events/:id/teams/invites/:inviteId/reject
 */
router.post('/:id/teams/invites/:inviteId/reject',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('inviteId').isMongoId().withMessage('Invalid Invite ID.')
  ],
  validate,
  eventController.rejectTeamInvite
);

/**
 * POST /api/v1/events/:id/teams/:teamId/verify
 * User clicks "Verify" to verify their participation in the team created by the leader
 */
router.post('/:id/teams/:teamId/verify',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.')
  ],
  validate,
  eventController.verifyTeamParticipation
);

/**
 * POST /api/v1/events/:id/teams/:teamId/leave
 */
router.post('/:id/teams/:teamId/leave',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.')
  ],
  validate,
  eventController.leaveTeam
);

/**
 * POST /api/v1/events/:id/teams/:teamId/propose-swap
 */
router.post('/:id/teams/:teamId/propose-swap',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.'),
    body('proposedLeaderId').isMongoId().withMessage('Proposed leader ID is required.')
  ],
  validate,
  eventController.proposeLeaderSwap
);

/**
 * POST /api/v1/events/:id/teams/:teamId/accept-swap
 */
router.post('/:id/teams/:teamId/accept-swap',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.')
  ],
  validate,
  eventController.acceptLeaderSwap
);

/**
 * POST /api/v1/events/:id/teams/:teamId/reject-swap
 */
router.post('/:id/teams/:teamId/reject-swap',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.')
  ],
  validate,
  eventController.rejectLeaderSwap
);

// ==========================================
// TASKS
// ==========================================

router.post('/:id/tasks',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    body('title').trim().notEmpty().withMessage('Title required.'),
    body('order').isInt({ min: 1 }).withMessage('Order required (positive integer).')
  ],
  validate,
  eventController.createTask
);

// Fetches tasks available to the user (respecting dynamic unlock mode)
router.get('/:id/tasks',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.listTasks
);

router.delete('/:id/tasks/:taskId',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('taskId').isMongoId().withMessage('Invalid Task ID.')
  ],
  validate,
  eventController.deleteTask
);

// ==========================================
// SUBMISSIONS
// ==========================================

router.post('/:id/tasks/:taskId/submit',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('taskId').isMongoId().withMessage('Invalid Task ID.'),
    body('content').notEmpty().withMessage('Content required.')
  ],
  validate,
  eventController.submitTask
);

// For organizers to grade submissions
router.get('/:id/tasks/:taskId/submissions',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('taskId').isMongoId().withMessage('Invalid Task ID.')
  ],
  validate,
  eventController.listSubmissions
);

// Manual evaluation (grantReward defaults to true — rewards fire on "correct")
router.post('/:id/submissions/:submissionId/evaluate',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('submissionId').isMongoId().withMessage('Invalid Submission ID.'),
    body('status').isIn(['correct', 'wrong']).withMessage('Status must be correct or wrong.'),
    body('scoreAwarded').isInt().withMessage('Score is required.'),
    body('grantReward').optional().isBoolean().withMessage('grantReward must be a boolean.')
  ],
  validate,
  eventController.evaluateSubmission
);

// ==========================================
// REWARD RULES + GRANT LEDGER
// ==========================================

/**
 * GET /api/v1/events/:id/reward-rules
 * Organizer: list this event's reward rules.
 */
router.get('/:id/reward-rules',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.listRewardRules
);

/**
 * POST /api/v1/events/:id/reward-rules
 * Organizer: create a reward rule (submission or rank trigger).
 */
router.post('/:id/reward-rules',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    body('trigger').isIn(['submission', 'rank']).withMessage('Trigger must be submission or rank.'),
    body('creditsPerUser').optional().isInt({ min: 0 }).withMessage('Credits per user must be a non-negative integer.'),
    body('rank').optional().isInt({ min: 1 }).withMessage('Rank must be a positive integer.'),
    body('badgeIds').optional().isArray().withMessage('badgeIds must be an array.'),
    body('maxUses').optional({ nullable: true }).isInt({ min: 1 }).withMessage('maxUses must be a positive integer or null.')
  ],
  validate,
  eventController.createRewardRule
);

/**
 * PATCH /api/v1/events/:id/reward-rules/:ruleId
 * Organizer: update a reward rule.
 */
router.patch('/:id/reward-rules/:ruleId',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('ruleId').isMongoId().withMessage('Invalid Rule ID.')
  ],
  validate,
  eventController.updateRewardRule
);

/**
 * DELETE /api/v1/events/:id/reward-rules/:ruleId
 * Organizer: delete a reward rule.
 */
router.delete('/:id/reward-rules/:ruleId',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('ruleId').isMongoId().withMessage('Invalid Rule ID.')
  ],
  validate,
  eventController.deleteRewardRule
);

/**
 * GET /api/v1/events/:id/rewards
 * Organizer: audit ledger of every credit/badge payout in this event.
 */
router.get('/:id/rewards',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.listRewardGrants
);

// ==========================================
// LEADERBOARD
// ==========================================

router.get('/:id/leaderboard',
  [param('id').isMongoId().withMessage('Invalid Event ID.')],
  validate,
  eventController.getLeaderboard
);

// Manual point adjustments by organizers
router.post('/:id/teams/:teamId/points',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.'),
    body('pointsAdded').isInt().withMessage('pointsAdded must be an integer.'),
    body('reason').optional().isString()
  ],
  validate,
  eventController.adjustTeamPoints
);

// Admin / Organizer granting credits/badges to the entire team
// (pocket-funded for non-admins — debited from the actor's own balance)
router.post('/:id/teams/:teamId/rewards',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.'),
    param('teamId').isMongoId().withMessage('Invalid Team ID.'),
    body('credits').optional().isInt({ min: 1 }),
    body('badgeIds').optional().isArray()
  ],
  validate,
  eventController.awardTeamRewards
);

// Admin / Organizer Distribute all configured rewards
router.post('/:id/distribute-rewards',
  [
    param('id').isMongoId().withMessage('Invalid Event ID.')
  ],
  validate,
  eventController.distributeRewards
);

module.exports = router;
