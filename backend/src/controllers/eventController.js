const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { success, error } = require('../utils/apiResponse');
const { evaluateSubmissionContent, computeScore } = require('../services/eventEvaluationService');
const {
  RewardError,
  payoutRule,
  listGrants,
  sanitizeRuleInput,
  isGlobalAdmin,
  ORGANIZER_RULE_LIMITS,
  MAX_RULES_PER_EVENT,
} = require('../services/eventRewardService');
const prisma = new PrismaClient();

/**
 * Strip private/secret fields from event payloads before returning to clients.
 * Invite tokens are secret (only shared via the generate endpoint); user-ID
 * whitelists/blacklists are personal data and should not leak to non-organizers.
 */
function sanitizeEvent(event, { isOrganizer = false } = {}) {
  if (!event) return event;
  const safe = { ...event };
  if (!isOrganizer) {
    delete safe.inviteToken;
    delete safe.inviteTokenExpiry;
    delete safe.allowedUserIds;
    delete safe.blockedUserIds;
  }
  return safe;
}

/**
 * Event-creation privilege:
 *   - global admins (ring 0) and users the admin granted canCreateEvents may
 *     target cohorts/groups and choose the invite mode;
 *   - everyone else gets an invite-only event with NO cohort targeting — the
 *     event spreads exclusively via the shareable invite link and team/friend
 *     invitations.
 */
function canTargetGroups(user) {
  return user.globalRing === 0 || user.canCreateEvents === true;
}

const ORGANIZER_GUARD = (user, event) =>
  event.creatorId === user.id || event.organizers?.some(o => o.userId === user.id) || user.globalRing === 0;

/**
 * Load enabled rules that fire on a correct submission, plus the team + event
 * needed to pay them out.
 */
async function grantSubmissionRewards({ event, team, submission, grantedById }) {
  const rules = await prisma.eventRewardRule.findMany({
    where: { eventId: event.id, trigger: 'submission', enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  const paid = [];
  for (const rule of rules) {
    let grants = [];
    let skipped = null;
    try {
      ({ grants, skipped } = await payoutRule({
        rule,
        team,
        submissionId: submission.id,
        grantedById,
      }));
    } catch (err) {
      // A broke funder must not take the participant's correct answer down
      // with it — record the skip and move on.
      if (err instanceof RewardError) skipped = err.message;
      else throw err;
    }
    paid.push({ rule, grants, skipped });
  }
  return paid;
}

exports.listEvents = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    // Find events matching user targeting tags or public events (empty targetTags)
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { targetTags: { isEmpty: true } },
          { targetTags: { hasSome: user.cohortTags || [] } }
        ],
        // Optionally filter by status based on business logic, here we fetch all for debugging
      },
      include: {
        subEvents: true,
        creator: {
          select: { id: true, displayName: true, avatarUrl: true }
        }
      },
      orderBy: { startDate: 'asc' }
    });

    return success(res, events.map(e => sanitizeEvent(e)));
  } catch (err) {
    next(err);
  }
};

exports.listManagedEvents = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    let events = [];
    if (user.globalRing === 0) {
      events = await prisma.event.findMany({
        include: { rewardRules: { select: { id: true, name: true, trigger: true, enabled: true } } },
        orderBy: { createdAt: 'desc' }
      });
    } else {
      events = await prisma.event.findMany({
        where: {
          OR: [
            { creatorId: user.id },
            { organizers: { some: { userId: user.id } } }
          ]
        },
        include: { rewardRules: { select: { id: true, name: true, trigger: true, enabled: true } } },
        orderBy: { createdAt: 'desc' }
      });
    }

    // Managed events: organizers may manage access lists, but the raw invite
    // token still stays secret — it is only re-shared via the invite-link endpoint.
    return success(res, events.map(e => ({ ...e, inviteToken: undefined })));
  } catch (err) {
    next(err);
  }
};

exports.getEvent = async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, displayName: true, avatarUrl: true } },
        subEvents: true,
        organizers: {
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true, globalRing: true } }
          }
        }
      }
    });

    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isOrganizer = event.creatorId === user.id || event.organizers.some(o => o.userId === user.id);
    const organizerView = isOrganizer || user.globalRing === 0;

    if (organizerView) {
      // Reward rules are organizer/participant-incentive config — public to
      // organizers only; participants see actual payouts in their results.
      event.rewardRules = await prisma.eventRewardRule.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'asc' },
      });
    }

    return success(res, sanitizeEvent(event, { isOrganizer: organizerView }));
  } catch (err) {
    next(err);
  }
};

exports.createEvent = async (req, res, next) => {
  try {
    const {
      title, description, startDate, endDate, durationHours, durationMinutes, category, targetTags: targetTagsRaw,
      parentId, keepTeamsSame, isTeamEvent, minTeamSize, maxTeamSize, status,
      taskViewMode, scoreMode, wrongSubmissionPenalty, autoStart,
      inviteMode: inviteModeRaw, allowedCohorts: allowedCohortsRaw, blockedCohorts: blockedCohortsRaw, allowedUserIds, blockedUserIds
    } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    // ANY authenticated user may create events, but without admin permission
    // (global admin or canCreateEvents) the event is invite-only and may NOT
    // target cohorts/groups — it spreads via invite link, team invites and
    // friends only. Group targeting is an admin-granted capability.
    const mayTargetGroups = canTargetGroups(user);

    const targetTags = mayTargetGroups ? (targetTagsRaw || []) : [];
    const inviteMode = mayTargetGroups ? (inviteModeRaw || 'open') : 'invite_only';
    const allowedCohorts = mayTargetGroups ? (allowedCohortsRaw || []) : [];
    const blockedCohorts = mayTargetGroups ? (blockedCohortsRaw || []) : [];

    // If it's a subevent, check if user is an organizer of the parent event
    if (parentId) {
      const parent = await prisma.event.findUnique({
        where: { id: parentId },
        include: { organizers: true }
      });
      if (!parent) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Parent event not found.' } });
      
      const isOrganizer = parent.creatorId === user.id || parent.organizers.some(o => o.userId === user.id);
      if (!isOrganizer && user.globalRing !== 0) {
         return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized to add sub-events.' } });
      }
    }

    const event = await prisma.event.create({
      data: {
        title,
        description,
        startDate,
        endDate,
        durationHours: durationHours || 0,
        durationMinutes: durationMinutes || 0,
        category,
        taskViewMode: taskViewMode || 'all',
        scoreMode: scoreMode || 'constant',
        wrongSubmissionPenalty: wrongSubmissionPenalty || 0,
        targetTags,
        parentId,
        keepTeamsSame: keepTeamsSame || false,
        isTeamEvent: isTeamEvent || false,
        minTeamSize: minTeamSize || 1,
        maxTeamSize: maxTeamSize || 1,
        status: status || 'draft',
        autoStart: autoStart !== undefined ? autoStart : true,
        creatorId: user.id,
        inviteMode,
        allowedCohorts,
        blockedCohorts,
        allowedUserIds: allowedUserIds || [],
        blockedUserIds: blockedUserIds || []
      }
    });

    // Automatically make creator an organizer
    await prisma.eventOrganizer.create({
      data: {
        eventId: event.id,
        userId: user.id,
        ring: 0,
        permissions: { canEditDetails: true, canCreateSubevents: true, canManageTeams: true, canAwardPoints: true, canManageRoles: true }
      }
    });

    // Phase migration logic for kept teams
    if (parentId && keepTeamsSame) {
      const parentTeams = await prisma.eventTeam.findMany({
        where: { eventId: parentId, status: 'qualified_for_next_phase' },
        include: { members: true }
      });
      
      for (const team of parentTeams) {
        const newTeam = await prisma.eventTeam.create({
          data: {
            eventId: event.id,
            name: team.name,
            leaderId: team.leaderId,
            status: 'registered'
          }
        });
        
        await prisma.eventTeamMember.createMany({
          data: team.members.map(m => ({
            teamId: newTeam.id,
            userId: m.userId
          }))
        });
      }
    }

    return success(res, event, 201);
  } catch (err) {
    next(err);
  }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const event = await prisma.event.findUnique({
      where: { id },
      include: { organizers: true }
    });

    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isOrganizer = event.creatorId === user.id || event.organizers.some(o => o.userId === user.id);
    
    if (!isOrganizer && user.globalRing !== 0) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized.' } });
    }

    const isCreatorOrGlobalAdmin = event.creatorId === user.id || user.globalRing === 0;

    // Never allow privileged fields to be mass-assigned from the request body.
    const FORBIDDEN_FIELDS = ['creatorId', 'parentId', 'id', 'organizers'];
    for (const f of FORBIDDEN_FIELDS) delete body[f];

    // Granular permissions check
    const organizerRec = event.organizers.find(o => o.userId === user.id);
    const perms = organizerRec ? organizerRec.permissions || {} : {};
    
    // If not creator and not global admin, check specific permissions and
    // restrict which fields may change.
    if (!isCreatorOrGlobalAdmin) {
      if ((body.startDate || body.endDate) && !perms.canChangeTiming) {
         return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized to change timings.' } });
      }
      if ((body.durationHours || body.durationMinutes) && !perms.canChangeDurationWhileRunning) {
         return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized to change duration.' } });
      }
      if (body.wrongSubmissionPenalty !== undefined && !perms.canChangePenalty) {
         return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized to change penalty.' } });
      }
      if (!perms.canEditDetails) {
         delete body.title;
         delete body.description;
         delete body.category;
      }
      // Non-creator organizers cannot change lifecycle/eligibility fields
      for (const f of ['status', 'targetTags', 'minTeamSize', 'maxTeamSize', 'isTeamEvent', 'autoStart', 'keepTeamsSame', 'taskViewMode', 'scoreMode', 'inviteMode', 'allowedCohorts', 'blockedCohorts', 'allowedUserIds', 'blockedUserIds']) {
         delete body[f];
      }
    }

    // Only allow editing sensible fields at all — strip anything unexpected
    const ALLOWED_FIELDS = ['title', 'description', 'category', 'startDate', 'endDate',
      'durationHours', 'durationMinutes', 'wrongSubmissionPenalty', 'status', 'targetTags',
      'minTeamSize', 'maxTeamSize', 'isTeamEvent', 'autoStart',
      'keepTeamsSame', 'taskViewMode', 'scoreMode',
      'inviteMode', 'allowedCohorts', 'blockedCohorts', 'allowedUserIds', 'blockedUserIds'];
    const updateData = {};
    for (const f of ALLOWED_FIELDS) {
      if (body[f] === undefined) continue;
      updateData[f] = body[f];
    }

    // Non-privileged creators/editors may never unlock cohort targeting or
    // switch an event to open registration — group targeting stays an
    // admin-granted capability (see canTargetGroups).
    if (!canTargetGroups(user)) {
      updateData.inviteMode = 'invite_only';
      updateData.targetTags = [];
      updateData.allowedCohorts = [];
      updateData.blockedCohorts = [];
    }

    const updatedEvent = await prisma.event.update({
      where: { id },
      data: updateData
    });

    return success(res, updatedEvent);
  } catch (err) {
    next(err);
  }
};

exports.deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: { organizers: true }
    });

    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    // Deleting an event nukes every team/submission for its participants —
    // only the creator or a global admin may do it, not any co-organizer.
    const isCreatorOrGlobalAdmin = event.creatorId === user.id || user.globalRing === 0;

    if (!isCreatorOrGlobalAdmin) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized.' } });
    }

    await prisma.event.delete({ where: { id } });

    return success(res, { message: 'Event deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.createTeam = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const { name } = req.body;

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const hasStarted = event.status === 'ongoing' || event.status === 'completed' || (event.autoStart && new Date() >= new Date(event.startDate));
    if (hasStarted) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Team formation is closed. The event has already started.' } });

    const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    const eligibility = eligibilityError(event, currentUser);
    if (eligibility) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: eligibility } });
    }

    // Invite-only events have no "Join" button — participation is via organizer
    // invite link or team invites only.
    if (event.inviteMode === 'invite_only') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This event is invite-only. Join via an organizer invite link or a team invitation.' } });
    }

    if (event.targetTags && event.targetTags.length > 0) {
      if (!currentUser.cohortTags || !event.targetTags.some(tag => currentUser.cohortTags.includes(tag))) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not eligible to participate in this event.' } });
      }
    }

    // Check if user is already in a team for this event
    const existingTeam = await prisma.eventTeamMember.findFirst({
      where: {
        userId: req.user.id,
        team: { eventId }
      }
    });

    if (existingTeam) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'You are already in a team for this event.' } });
    }

    const team = await prisma.eventTeam.create({
      data: {
        eventId,
        name,
        leaderId: req.user.id,
        status: (event.isTeamEvent && event.minTeamSize > 1) ? 'pending' : 'registered'
      }
    });

    await prisma.eventTeamMember.create({
      data: {
        teamId: team.id,
        userId: req.user.id
      }
    });

    return success(res, team, 201);
  } catch (err) {
    next(err);
  }
};

exports.listTeams = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers?.some(o => o.userId === req.user.id) || req.user.globalRing === 0;

    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      include: {
        leader: { select: { id: true, displayName: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true } }
          }
        },
        // Pending invites are private to organizers — regular members must
        // not learn who other teams are trying to recruit. The exception is
        // the caller's own invites, which they must see to accept/reject.
        ...(isOrganizer ? {
          invites: {
            include: {
              invitedUser: { select: { id: true, displayName: true, avatarUrl: true } }
            }
          }
        } : {
          invites: {
            where: { invitedUserId: req.user.id },
            include: {
              invitedUser: { select: { id: true, displayName: true, avatarUrl: true } }
            }
          }
        }),
      }
    });

    return success(res, teams);
  } catch (err) {
    next(err);
  }
};

exports.inviteToTeam = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const { userId } = req.body;

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId } });
    if (!team) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });

    // Cross-check the team actually belongs to this event — otherwise a team
    // from any other event could be invited/joined via this route.
    if (team.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found in this event.' } });
    }

    if (team.leaderId !== req.user.id) {
       return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only team leader can invite.' } });
    }

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const hasStarted = event.status === 'ongoing' || event.status === 'completed' || (event.autoStart && new Date() >= new Date(event.startDate));
    if (hasStarted) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot invite. The event has already started.' } });

    const membersCount = await prisma.eventTeamMember.count({ where: { teamId } });

    if (membersCount >= event.maxTeamSize) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'Team is full.' } });
    }

    const invitedUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!invitedUser) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });

    const eligibility = eligibilityError(event, invitedUser);
    if (eligibility) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Cannot invite: ${eligibility}` } });
    }

    if (event.targetTags && event.targetTags.length > 0) {
      if (!invitedUser.cohortTags || !event.targetTags.some(tag => invitedUser.cohortTags.includes(tag))) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'User is not eligible for this event.' } });
      }
    }


    const existingInvite = await prisma.eventTeamInvite.findUnique({
      where: { teamId_invitedUserId: { teamId, invitedUserId: userId } }
    });

    if (existingInvite) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'Invite already sent.' } });
    }

    const invite = await prisma.eventTeamInvite.create({
      data: {
        teamId,
        eventId,
        invitedUserId: userId,
        invitedBy: req.user.id,
      }
    });

    return success(res, invite, 201);
  } catch (err) {
    next(err);
  }
};

exports.acceptTeamInvite = async (req, res, next) => {
  try {
    const { id: eventId, inviteId } = req.params;

    const invite = await prisma.eventTeamInvite.findUnique({ where: { id: inviteId } });
    if (!invite) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found.' } });

    // The invite must belong to the same event the route was called for.
    if (invite.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found in this event.' } });
    }

    if (invite.invitedUserId !== req.user.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized.' } });
    }

    // A rejected invite is final — do not let users resurrect it to bypass
    // the leader's decision.
    if (invite.status === 'rejected') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'This invite has been rejected.' } });
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const hasStarted = event.status === 'ongoing' || event.status === 'completed' || (event.autoStart && new Date() >= new Date(event.startDate));
    if (hasStarted) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot join. The event has already started.' } });

    const membersCount = await prisma.eventTeamMember.count({ where: { teamId: invite.teamId } });
    if (membersCount >= event.maxTeamSize) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'Team is already full.' } });
    }

    const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } });

    const eligibility = eligibilityError(event, currentUser);
    if (eligibility) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Cannot join: ${eligibility}` } });
    }

    if (event.targetTags && event.targetTags.length > 0) {
      if (!currentUser.cohortTags || !event.targetTags.some(tag => currentUser.cohortTags.includes(tag))) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not eligible for this event.' } });
      }
    }

    // Check if user is already in a team
    const existingTeam = await prisma.eventTeamMember.findFirst({
      where: {
        userId: req.user.id,
        team: { eventId }
      }
    });

    if (existingTeam) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'You are already in a team.' } });
    }

    await prisma.eventTeamMember.create({
      data: { teamId: invite.teamId, userId: req.user.id }
    });

    await prisma.eventTeamInvite.update({
      where: { id: inviteId },
      data: { status: 'accepted' }
    });

    return success(res, { message: 'Invite accepted.' });
  } catch (err) {
    next(err);
  }
};

exports.rejectTeamInvite = async (req, res, next) => {
  try {
    const { id: eventId, inviteId } = req.params;

    const invite = await prisma.eventTeamInvite.findUnique({ where: { id: inviteId } });
    if (!invite) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found.' } });

    // The invite must belong to the same event the route was called for.
    if (invite.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found in this event.' } });
    }

    if (invite.invitedUserId !== req.user.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized.' } });
    }

    await prisma.eventTeamInvite.update({
      where: { id: inviteId },
      data: { status: 'rejected' }
    });

    return success(res, { message: 'Invite rejected.' });
  } catch (err) {
    next(err);
  }
};

// ===============================================
// ADVANCED EVENT MANAGEMENT (Tasks, Teams, Leaderboard)
// ===============================================

exports.addOrUpdateOrganizer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userId, permissions } = req.body;
    
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    if (event.creatorId !== req.user.id && req.user.globalRing !== 0) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only creator can manage organizers.' } });
    }

    const org = await prisma.eventOrganizer.upsert({
      where: { eventId_userId: { eventId: id, userId } },
      update: { permissions },
      create: { eventId: id, userId, permissions, ring: 1 }
    });

    return success(res, org);
  } catch (err) { next(err); }
};

exports.verifyTeamParticipation = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const member = await prisma.eventTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId: req.user.id } }
    });

    if (!member) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a member of this team.' } });

    const updated = await prisma.eventTeamMember.update({
      where: { teamId_userId: { teamId, userId: req.user.id } },
      data: { status: 'verified' }
    });

    return success(res, updated);
  } catch (err) { next(err); }
};

exports.leaveTeam = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const member = await prisma.eventTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId: req.user.id } }
    });
    
    if (!member) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not in this team.' } });

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId }, include: { members: true } });
    
    if (team.leaderId === req.user.id && team.members.length > 1) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Leader must swap leadership before leaving.' } });
    }

    await prisma.eventTeamMember.delete({
      where: { teamId_userId: { teamId, userId: req.user.id } }
    });

    // Clean up empty team
    if (team.members.length === 1) {
      await prisma.eventTeam.delete({ where: { id: teamId } });
    }

    return success(res, { message: 'Left team successfully.' });
  } catch (err) { next(err); }
};

exports.proposeLeaderSwap = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const { proposedLeaderId } = req.body;

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId } });
    if (!team) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });
    if (team.leaderId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only leader can swap.' } });

    const targetMember = await prisma.eventTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId: proposedLeaderId } }
    });

    if (!targetMember) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Proposed user not a team member.' } });

    const updated = await prisma.eventTeam.update({
      where: { id: teamId },
      data: { proposedLeaderId }
    });

    return success(res, updated);
  } catch (err) { next(err); }
};

exports.acceptLeaderSwap = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await prisma.eventTeam.findUnique({ where: { id: teamId } });
    
    if (team.proposedLeaderId !== req.user.id) {
       return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not the proposed leader.' } });
    }

    const updated = await prisma.eventTeam.update({
      where: { id: teamId },
      data: { leaderId: req.user.id, proposedLeaderId: null }
    });
    
    return success(res, updated);
  } catch (err) { next(err); }
};

exports.rejectLeaderSwap = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await prisma.eventTeam.findUnique({ where: { id: teamId } });
    
    if (team.proposedLeaderId !== req.user.id) {
       return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not the proposed leader.' } });
    }

    const updated = await prisma.eventTeam.update({
      where: { id: teamId },
      data: { proposedLeaderId: null }
    });
    
    return success(res, updated);
  } catch (err) { next(err); }
};

exports.createTask = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const { 
      title, description, order, basePoints, submissionType, submissionConfig, 
      isAutoEvaluated, isDynamicScore, decayPercentage, wrongSubmissionPenalty 
    } = req.body;

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id);
    if (!isOrganizer && req.user.globalRing !== 0) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    const task = await prisma.eventTask.create({
      data: {
        eventId, title, description, order, basePoints: basePoints || 100, 
        submissionType: submissionType || 'text',
        submissionConfig, isAutoEvaluated: isAutoEvaluated || false,
        isDynamicScore: isDynamicScore || false,
        decayPercentage: decayPercentage || 0,
        wrongSubmissionPenalty: wrongSubmissionPenalty || 0
      }
    });
    return success(res, task, 201);
  } catch (err) { next(err); }
};

exports.deleteTask = async (req, res, next) => {
  try {
    const { id: eventId, taskId } = req.params;
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id) || req.user.globalRing === 0;
    if (!isOrganizer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can delete tasks.' } });

    await prisma.eventTask.delete({ where: { id: taskId } });
    return success(res, { message: 'Task deleted successfully.' });
  } catch (err) { next(err); }
};

exports.listTasks = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });

    if (!event) {
      return error(res, 'NOT_FOUND', 'Event not found.', 404);
    }

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id) || req.user.globalRing === 0;

    // Non-organizers must be event participants (in a team) to see any tasks.
    if (!isOrganizer) {
      const participant = await prisma.eventTeamMember.findFirst({
        where: { userId: req.user.id, team: { eventId } },
        select: { teamId: true },
      });
      if (!participant) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not a participant of this event.' } });
      }
    }

    let tasks = await prisma.eventTask.findMany({
      where: { eventId },
      orderBy: { order: 'asc' }
    });

    if (!isOrganizer) {
      // HARDENING: never ship answer keys (correctOptions / exactText) to
      // participants — they could trivially cheat auto-graded tasks.
      tasks = tasks.map(t => {
        const config = t.submissionConfig ? { ...t.submissionConfig } : null;
        if (config) {
          delete config.correctOptions;
          delete config.exactText;
        }
        return { ...t, submissionConfig: config };
      });
    }

    if (!isOrganizer && event.taskViewMode === 'dynamic') {
      // Find max completed task order for the user's team
      const teamMember = await prisma.eventTeamMember.findFirst({
        where: { userId: req.user.id, team: { eventId } },
        include: { team: { include: { submissions: { where: { status: 'correct' }, include: { task: true } } } } }
      });

      if (teamMember) {
        let maxOrder = 0;
        teamMember.team.submissions.forEach(sub => {
          if (sub.task.order > maxOrder) maxOrder = sub.task.order;
        });
        
        // Show up to the next task
        tasks = tasks.filter(t => t.order <= maxOrder + 1);
      } else {
        // Not in team, show only first task or none
        tasks = tasks.filter(t => t.order === 1);
      }
    }

    return success(res, tasks);
  } catch (err) { next(err); }
};

exports.submitTask = async (req, res, next) => {
  try {
    const { id: eventId, taskId } = req.params;
    const { content } = req.body;

    const task = await prisma.eventTask.findUnique({ where: { id: taskId, eventId } });
    if (!task) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });

    const member = await prisma.eventTeamMember.findFirst({
      where: { userId: req.user.id, team: { eventId } },
      include: { team: { include: { members: true } } }
    });

    if (!member) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not in a team.' } });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    // Auto-grading: mcq / true_false / checkboxes / text / url tasks evaluate
    // against the answer key; everything else waits for an organizer.
    const { status } = evaluateSubmissionContent(task, content);
    const scoreAwarded = computeScore({ task, event, submittedAt: new Date(), status });

    let sub;
    try {
      sub = await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: two concurrent "correct" submits
        // must not both slip past the guard and double-pay the auto reward.
        const alreadyCorrect = await tx.eventSubmission.findFirst({
          where: { teamId: member.teamId, taskId, status: 'correct' }
        });
        if (alreadyCorrect) {
          return { alreadySolved: true };
        }
        return tx.eventSubmission.create({
          data: {
            eventId,
            teamId: member.teamId,
            taskId,
            content,
            status,
            scoreAwarded
          }
        });
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Already solved.' } });
      }
      throw err;
    }

    if (sub.alreadySolved) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Already solved.' } });
    }

    // AUTO-REWARD: every enabled "submission" rule pays out on this answer.
    // Rules are atomic (per-rule use counter + per-submission idempotency), so
    // concurrent correct submits cannot double-pay. A rule whose funder runs
    // dry is skipped gracefully — the submission itself still counts.
    const rewards = [];
    if (status === 'correct') {
      const paid = await grantSubmissionRewards({ event, team: member.team, submission: sub, grantedById: req.user.id });
      for (const { rule, skipped } of paid) {
        rewards.push({
          ruleId: rule.id,
          name: rule.name,
          creditsPerUser: rule.creditsPerUser,
          badgeIds: rule.badgeIds,
          status: skipped ? 'skipped' : 'granted',
          skipped,
        });
      }
    }

    return success(res, { ...sub, rewards }, 201);
  } catch (err) { next(err); }
};

// ===============================================================
// REWARD RULES + GRANT LEDGER
// ===============================================================

// Organizer guard helper shared by every reward endpoint.
async function loadEventForOrganizer(eventId, user) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organizers: true },
  });
  if (!event) return { event: null, error: { code: 'NOT_FOUND', message: 'Event not found.' } };
  if (!ORGANIZER_GUARD(user, event)) {
    return { event: null, error: { code: 'FORBIDDEN', message: 'Only organizers can manage rewards.' } };
  }
  return { event, error: null };
}

function ruleInputError(err) {
  return err instanceof RewardError
    ? { status: 400, error: { code: err.code, message: err.message } }
    : null;
}

/**
 * Build the leaderboard once, reused by getLeaderboard and
 * distributeRewards — both used to duplicate the scoring math.
 */
function computeLeaderboard(event, teams) {
  const leaderboard = teams.map(team => {
    let totalScore = team.points || 0; // Legacy base points
    const history = [];

    (team.submissions || []).forEach(sub => {
      const change = computeScore({ task: sub.task, event, submittedAt: sub.submittedAt, status: sub.status });
      totalScore += change;
      if (sub.status === 'correct') {
        history.push({ type: 'submission', taskId: sub.taskId, taskTitle: sub.task.title, scoreChange: change, date: sub.submittedAt, status: 'correct' });
      } else if (sub.status === 'wrong') {
        history.push({ type: 'submission', taskId: sub.taskId, taskTitle: sub.task.title, scoreChange: change, date: sub.submittedAt, status: 'wrong' });
      }
    });

    (team.pointAdjustments || []).forEach(adj => {
      totalScore += adj.pointsAdded;
      history.push({ type: 'adjustment', reason: adj.reason, awardedBy: adj.awardedBy?.displayName, scoreChange: adj.pointsAdded, date: adj.createdAt });
    });

    history.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { id: team.id, name: team.name, score: Math.round(totalScore), history, team };
  });

  leaderboard.sort((a, b) => b.score - a.score);
  return leaderboard;
}

exports.listRewardRules = async (req, res, next) => {
  try {
    const { event, error } = await loadEventForOrganizer(req.params.id, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const rules = await prisma.eventRewardRule.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
    });
    return success(res, rules);
  } catch (err) { next(err); }
};

exports.createRewardRule = async (req, res, next) => {
  try {
    const { event, error } = await loadEventForOrganizer(req.params.id, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const ruleCount = await prisma.eventRewardRule.count({ where: { eventId: event.id } });
    if (ruleCount >= MAX_RULES_PER_EVENT) {
      return res.status(400).json({ error: { code: 'LIMIT_EXCEEDED', message: `An event can have at most ${MAX_RULES_PER_EVENT} reward rules.` } });
    }

    let input;
    try {
      input = sanitizeRuleInput(req.body, await isGlobalAdmin(req.user.id));
    } catch (err) {
      const handled = ruleInputError(err);
      if (handled) return res.status(handled.status).json({ error: handled.error });
      throw err;
    }

    const rule = await prisma.eventRewardRule.create({
      data: { ...input, eventId: event.id, createdById: req.user.id, enabled: true },
    });
    return success(res, rule, 201);
  } catch (err) { next(err); }
};

exports.updateRewardRule = async (req, res, next) => {
  try {
    const { event, error } = await loadEventForOrganizer(req.params.id, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const rule = await prisma.eventRewardRule.findFirst({
      where: { id: req.params.ruleId, eventId: event.id },
    });
    if (!rule) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reward rule not found.' } });

    let input;
    try {
      input = sanitizeRuleInput({ ...rule, ...req.body }, await isGlobalAdmin(req.user.id));
    } catch (err) {
      const handled = ruleInputError(err);
      if (handled) return res.status(handled.status).json({ error: handled.error });
      throw err;
    }

    const updated = await prisma.eventRewardRule.update({
      where: { id: rule.id },
      data: {
        name: input.name,
        creditsPerUser: input.creditsPerUser,
        badgeIds: input.badgeIds,
        maxUses: input.maxUses,
        ...(input.trigger === 'rank' ? { rank: input.rank } : {}),
        enabled: req.body.enabled !== undefined ? Boolean(req.body.enabled) : rule.enabled,
      },
    });
    return success(res, updated);
  } catch (err) { next(err); }
};

exports.deleteRewardRule = async (req, res, next) => {
  try {
    const { event, error } = await loadEventForOrganizer(req.params.id, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const rule = await prisma.eventRewardRule.findFirst({
      where: { id: req.params.ruleId, eventId: event.id },
    });
    if (!rule) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reward rule not found.' } });

    await prisma.eventRewardRule.delete({ where: { id: rule.id } });
    return success(res, { message: 'Reward rule deleted.' });
  } catch (err) { next(err); }
};

exports.listRewardGrants = async (req, res, next) => {
  try {
    const { event, error } = await loadEventForOrganizer(req.params.id, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const grants = await listGrants(event.id);
    return success(res, grants);
  } catch (err) { next(err); }
};

/**
 * Shared helper — is the user the event creator, an organizer, or a global admin?
 */
async function isEventOrganizer(eventId, userId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { creatorId: true, organizers: { select: { userId: true } } },
  });
  if (!event) return { event: null, isOrganizer: false };
  const isOrganizer =
    event.creatorId === userId ||
    event.organizers.some(o => o.userId === userId);
  return { event, isOrganizer };
}

/**
 * Eligibility check against an event's whitelist/blacklist.
 * - Blacklisted user → denied.
 * - Blacklisted cohort tag → denied.
 * - If a whitelist exists (allowedUserIds / allowedCohorts non-empty),
 *   the user must match at least one whitelist rule.
 * - Global admins always pass.
 * Returns null when eligible, otherwise an error message.
 */
function eligibilityError(event, user) {
  if (user.globalRing === 0) return null;
  if (event.creatorId === user.id) return null;
  if (event.organizers?.some(o => o.userId === user.id)) return null;

  if ((event.blockedUserIds || []).includes(user.id)) {
    return 'You are blacklisted from this event.';
  }
  const userTags = user.cohortTags || [];
  const blockedCohorts = event.blockedCohorts || [];
  if (blockedCohorts.some(tag => userTags.includes(tag))) {
    return 'Your cohort is blacklisted from this event.';
  }

  const allowedUsers = event.allowedUserIds || [];
  const allowedCohorts = event.allowedCohorts || [];
  const hasWhitelist = allowedUsers.length > 0 || allowedCohorts.length > 0;
  if (hasWhitelist) {
    const allowedByUser = allowedUsers.includes(user.id);
    const allowedByCohort = allowedCohorts.some(tag => userTags.includes(tag));
    if (!allowedByUser && !allowedByCohort) {
      return 'This event is restricted to whitelisted users/cohorts.';
    }
  }
  return null;
}

const EVENT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

exports.generateEventInviteLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isOrganizer, event } = await isEventOrganizer(id, req.user.id);
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });
    if (!isOrganizer && req.user.globalRing !== 0) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can create invite links.' } });
    }

    // Rotating links: keep the existing token while it's still valid.
    const existing = await prisma.event.findUnique({
      where: { id },
      select: { inviteToken: true, inviteTokenExpiry: true }
    });
    if (existing.inviteToken && existing.inviteTokenExpiry && existing.inviteTokenExpiry.getTime() > Date.now()) {
      return success(res, { token: existing.inviteToken, expiresAt: existing.inviteTokenExpiry });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EVENT_INVITE_TTL_MS);
    await prisma.event.update({
      where: { id },
      data: { inviteToken: token, inviteTokenExpiry: expiresAt }
    });

    return success(res, { token, expiresAt });
  } catch (err) { next(err); }
};

exports.getEventInviteInfo = async (req, res, next) => {
  try {
    const { token } = req.params;
    const event = await prisma.event.findFirst({ where: { inviteToken: token }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite link not found.' } });
    if (!event.inviteTokenExpiry || event.inviteTokenExpiry.getTime() < Date.now()) {
      return res.status(410).json({ error: { code: 'EXPIRED', message: 'This invite link has expired.' } });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const eligibility = eligibilityError(event, user);

    const alreadyJoined = await prisma.eventTeamMember.findFirst({
      where: { userId: req.user.id, team: { eventId: event.id } }
    });

    return success(res, {
      id: event.id,
      title: event.title,
      description: event.description,
      category: event.category,
      startDate: event.startDate,
      status: event.status,
      isTeamEvent: event.isTeamEvent,
      minTeamSize: event.minTeamSize,
      maxTeamSize: event.maxTeamSize,
      inviteMode: event.inviteMode,
      eligible: eligibility === null,
      reason: eligibility,
      alreadyJoined: !!alreadyJoined
    });
  } catch (err) { next(err); }
};

exports.joinEventViaInvite = async (req, res, next) => {
  try {
    const { token } = req.params;
    const event = await prisma.event.findFirst({ where: { inviteToken: token }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite link not found.' } });
    if (!event.inviteTokenExpiry || event.inviteTokenExpiry.getTime() < Date.now()) {
      return res.status(410).json({ error: { code: 'EXPIRED', message: 'This invite link has expired.' } });
    }

    const hasStarted = event.status === 'ongoing' || event.status === 'completed' ||
      (event.autoStart && new Date() >= new Date(event.startDate));
    if (hasStarted) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'The event has already started.' } });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const eligibility = eligibilityError(event, user);
    if (eligibility) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: eligibility } });
    }

    // Already in a team → return it (idempotent join).
    const existing = await prisma.eventTeamMember.findFirst({
      where: { userId: req.user.id, team: { eventId: event.id } },
      include: { team: true }
    });
    if (existing) return success(res, { team: existing.team, alreadyJoined: true });

    const team = await prisma.eventTeam.create({
      data: {
        eventId: event.id,
        name: `${user.displayName || 'Member'}'s Team`,
        leaderId: req.user.id,
        status: (event.isTeamEvent && event.minTeamSize > 1) ? 'pending' : 'registered'
      }
    });

    await prisma.eventTeamMember.create({
      data: { teamId: team.id, userId: req.user.id, status: 'verified' }
    });

    return success(res, { team, alreadyJoined: false }, 201);
  } catch (err) { next(err); }
};

exports.listSubmissions = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.eventTask.findUnique({ where: { id: taskId }, select: { eventId: true } });
    if (!task) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });

    const { isOrganizer } = await isEventOrganizer(task.eventId, req.user.id);
    const globalAdmin = req.user.globalRing === 0;
    if (!isOrganizer && !globalAdmin) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can view submissions.' } });
    }

    const subs = await prisma.eventSubmission.findMany({
      where: { taskId },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { submittedAt: 'asc' }
    });
    return success(res, subs);
  } catch(err) { next(err); }
};

exports.evaluateSubmission = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { status, scoreAwarded, grantReward } = req.body;

    const sub = await prisma.eventSubmission.findUnique({
      where: { id: submissionId },
      select: { taskId: true },
    });
    if (!sub) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Submission not found.' } });

    const task = await prisma.eventTask.findUnique({ where: { id: sub.taskId }, select: { eventId: true } });
    const { isOrganizer } = task ? await isEventOrganizer(task.eventId, req.user.id) : { isOrganizer: false };
    const globalAdmin = req.user.globalRing === 0;
    if (!isOrganizer && !globalAdmin) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can evaluate submissions.' } });
    }

    const updated = await prisma.eventSubmission.update({
      where: { id: submissionId },
      data: {
        status,
        scoreAwarded: scoreAwarded || 0,
        evaluatedById: req.user.id,
        evaluatedAt: new Date()
      }
    });

    // Manual evaluations fire the same "submission" reward rules as auto
    // grading (opt out with grantReward: false). This is the organizer
    // "handing out rewards on evaluation" path.
    let rewards = [];
    if (status === 'correct' && grantReward !== false) {
      const full = await prisma.eventSubmission.findUnique({
        where: { id: submissionId },
        include: { team: { include: { members: true } } },
      });
      const event = await prisma.event.findUnique({ where: { id: full.eventId } });
      const paid = await grantSubmissionRewards({ event, team: full.team, submission: full, grantedById: req.user.id });
      rewards = paid.map(({ rule, skipped }) => ({
        ruleId: rule.id,
        name: rule.name,
        creditsPerUser: rule.creditsPerUser,
        badgeIds: rule.badgeIds,
        status: skipped ? 'skipped' : 'granted',
        skipped,
      }));
    }

    return success(res, { ...updated, rewards });
  } catch(err) { next(err); }
};

exports.getLeaderboard = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND' } });

    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      include: {
        submissions: { include: { task: true } },
        pointAdjustments: { include: { awardedBy: { select: { displayName: true } } } }
      }
    });

    const leaderboard = computeLeaderboard(event, teams).map(({ team, ...rest }) => rest);
    return success(res, leaderboard);
  } catch(err) { next(err); }
};

exports.adjustTeamPoints = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const { pointsAdded, reason } = req.body;

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id) || req.user.globalRing === 0;
    if (!isOrganizer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can adjust points.' } });

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId }, select: { id: true, eventId: true } });
    if (!team || team.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found in this event.' } });
    }

    const adj = await prisma.teamPointAdjustment.create({
      data: {
        teamId,
        eventId,
        pointsAdded: parseInt(pointsAdded, 10),
        reason,
        awardedById: req.user.id
      }
    });

    return success(res, adj, 201);
  } catch(err) { next(err); }
};

exports.registerTeam = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const team = await prisma.eventTeam.findUnique({ 
        where: { id: teamId },
        include: { members: true }
    });
    
    if (!team) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found.' } });

    if (team.leaderId !== req.user.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only team leader can register the team.' } });
    }

    if (team.status === 'registered') {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Team is already registered.' } });
    }
    
    // Validate team sizes
    if (team.members.length < event.minTeamSize) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Team must have at least ${event.minTeamSize} members to register.` } });
    }
    
    if (team.members.length > event.maxTeamSize) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Team cannot exceed ${event.maxTeamSize} members.` } });
    }

    const updatedTeam = await prisma.eventTeam.update({
        where: { id: teamId },
        data: { status: 'registered' }
    });

    return success(res, updatedTeam);
  } catch (err) {
    next(err);
  }
};

exports.awardTeamRewards = async (req, res, next) => {
  try {
    const { id: eventId, teamId } = req.params;
    const { credits, badgeIds, badgeId } = req.body;

    const { event, error } = await loadEventForOrganizer(eventId, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId }, include: { members: true } });
    if (!team || team.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found in this event.' } });
    }

    const parsedCredits = Math.floor(Number(credits));
    const safeCredits = Number.isFinite(parsedCredits) && parsedCredits > 0 ? parsedCredits : 0;
    const safeBadges = [...new Set((badgeIds || (badgeId ? [badgeId] : [])).filter(id => /^[0-9a-fA-F]{24}$/.test(id)))];

    if (safeCredits === 0 && safeBadges.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Grant credits and/or at least one badge.' } });
    }

    // Ad-hoc manual grant: no rule row, funded by the acting user's own pocket
    // (credits debited from THEIR balance, badges must be in THEIR inventory)
    // unless the actor is a global admin — admins mint, and may grant as often
    // as they like. Every payout lands in the grant ledger.
    const { grants, skipped } = await payoutRule({
      rule: {
        id: null,
        eventId: event.id,
        createdById: req.user.id,
        trigger: 'manual',
        creditsPerUser: safeCredits,
        badgeIds: safeBadges,
        maxUses: null,
      },
      team,
      grantedById: req.user.id,
    });

    if (skipped) {
      return res.status(skipped === 'insufficient_funds' ? 400 : 409).json({
        error: { code: 'REWARD_SKIPPED', message: `Reward not granted: ${skipped}.` },
      });
    }

    return success(res, { teamId, grants }, 201);
  } catch (err) {
    if (err instanceof RewardError) {
      return res.status(400).json({ error: { code: err.code, message: err.message } });
    }
    next(err);
  }
};

exports.distributeRewards = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;

    const { event, error } = await loadEventForOrganizer(eventId, req.user);
    if (error) return res.status(error.code === 'NOT_FOUND' ? 404 : 403).json({ error });

    const rules = await prisma.eventRewardRule.findMany({
      where: { eventId, trigger: 'rank', enabled: true },
      orderBy: { rank: 'asc' },
    });
    if (rules.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No enabled rank reward rules configured for this event.' } });
    }

    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      include: { submissions: { include: { task: true } }, pointAdjustments: true, members: true },
    });
    const leaderboard = computeLeaderboard(event, teams);

    // Rank payouts run once per rule (the ledger guard); a global admin may
    // re-run a rule as often as they want — they can give out however many.
    const admin = await isGlobalAdmin(req.user.id);
    const distributed = [];

    for (const rule of rules) {
      const placed = leaderboard[rule.rank - 1];
      if (!placed) {
        distributed.push({ ruleId: rule.id, name: rule.name, rank: rule.rank, skipped: 'no_team_at_rank' });
        continue;
      }

      if (!admin) {
        const prior = await prisma.eventRewardGrant.findFirst({
          where: { ruleId: rule.id, trigger: 'rank' },
          select: { id: true },
        });
        if (prior) {
          distributed.push({ ruleId: rule.id, name: rule.name, rank: rule.rank, skipped: 'already_distributed' });
          continue;
        }
      }

      const { grants, skipped } = await payoutRule({
        rule,
        team: placed.team,
        grantedById: req.user.id,
      });
      distributed.push({
        ruleId: rule.id,
        name: rule.name,
        rank: rule.rank,
        teamId: placed.team.id,
        teamName: placed.team.name,
        grants: grants.length,
        skipped,
      });
    }

    return success(res, { distributed });
  } catch (err) {
    if (err instanceof RewardError) {
      return res.status(400).json({ error: { code: err.code, message: err.message } });
    }
    next(err);
  }
};
