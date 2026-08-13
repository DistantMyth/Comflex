const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { success, error } = require('../utils/apiResponse');
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

    return success(res, sanitizeEvent(event, { isOrganizer: isOrganizer || user.globalRing === 0 }));
  } catch (err) {
    next(err);
  }
};

exports.createEvent = async (req, res, next) => {
  try {
    const {
      title, description, startDate, endDate, durationHours, durationMinutes, category, targetTags,
      parentId, keepTeamsSame, isTeamEvent, minTeamSize, maxTeamSize, status,
      taskViewMode, scoreMode, wrongSubmissionPenalty, autoStart,
      inviteMode, allowedCohorts, blockedCohorts, allowedUserIds, blockedUserIds, rewardBudget
    } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    // ANY authenticated user may create events; participation is invite-only
    // by default (inviteMode) so open registration can never be forced on people.

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
        targetTags: targetTags || [],
        parentId,
        keepTeamsSame: keepTeamsSame || false,
        isTeamEvent: isTeamEvent || false,
        minTeamSize: minTeamSize || 1,
        maxTeamSize: maxTeamSize || 1,
        status: status || 'draft',
        autoStart: autoStart !== undefined ? autoStart : true,
        creatorId: user.id,
        inviteMode: inviteMode || 'open',
        allowedCohorts: allowedCohorts || [],
        blockedCohorts: blockedCohorts || [],
        allowedUserIds: allowedUserIds || [],
        blockedUserIds: blockedUserIds || [],
        rewardBudget: rewardBudget || null
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
      // Non-creator organizers cannot change lifecycle/reward/eligibility fields
      for (const f of ['status', 'targetTags', 'minTeamSize', 'maxTeamSize', 'rewardTiers', 'isTeamEvent', 'autoStart', 'keepTeamsSame', 'taskViewMode', 'scoreMode', 'inviteMode', 'allowedCohorts', 'blockedCohorts', 'allowedUserIds', 'blockedUserIds', 'rewardBudget']) {
         delete body[f];
      }
    }

    // Only allow editing sensible fields at all — strip anything unexpected
    const ALLOWED_FIELDS = ['title', 'description', 'category', 'startDate', 'endDate',
      'durationHours', 'durationMinutes', 'wrongSubmissionPenalty', 'status', 'targetTags',
      'minTeamSize', 'maxTeamSize', 'rewardTiers', 'isTeamEvent', 'autoStart',
      'keepTeamsSame', 'taskViewMode', 'scoreMode',
      'inviteMode', 'allowedCohorts', 'blockedCohorts', 'allowedUserIds', 'blockedUserIds', 'rewardBudget'];
    const updateData = {};
    for (const f of ALLOWED_FIELDS) {
      if (body[f] !== undefined) updateData[f] = body[f];
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
    const isOrganizer = event.creatorId === user.id || event.organizers.some(o => o.userId === user.id);

    if (!isOrganizer && user.globalRing !== 0) {
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

    if (invite.invitedUserId !== req.user.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not authorized.' } });
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
    const { inviteId } = req.params;

    const invite = await prisma.eventTeamInvite.findUnique({ where: { id: inviteId } });
    if (!invite) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found.' } });

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
      include: { team: true }
    });

    if (!member) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not in a team.' } });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    // Ensure they haven't already solved it
    const existingCorrect = await prisma.eventSubmission.findFirst({
      where: { teamId: member.teamId, taskId, status: 'correct' }
    });

    if (existingCorrect) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Already solved.' } });

    let status = 'pending';
    let scoreAwarded = 0;

    if (task.isAutoEvaluated && task.submissionConfig) {
       // Simplistic text auto eval for now
       if (task.submissionType === 'text') {
         if (content.text && task.submissionConfig.exactText && content.text.trim() === task.submissionConfig.exactText) {
             status = 'correct';
         } else {
             status = 'wrong';
         }
       }
    }

    if (status === 'correct') {
       scoreAwarded = task.basePoints;
       // We'll apply dynamic scoring and penalties on the leaderboard endpoint for simplicity of recalculations,
       // or we deduct here. Let's award basePoints here and compute penalty dynamically.
    }

    const sub = await prisma.eventSubmission.create({
      data: {
        eventId,
        teamId: member.teamId,
        taskId,
        content,
        status,
        scoreAwarded
      }
    });

    // AUTO-REWARD: when a preconfigured answer is graded correct, distribute
    // credits/badges from the organizer's budget; when the budget runs out,
    // the event completes automatically.
    if (status === 'correct' && event.rewardBudget) {
      await applyRewardBudget(event, member.team, sub, scoreAwarded);
    }

    return success(res, sub, 201);
  } catch (err) { next(err); }
};

/**
 * Consume the event's reward budget for a correct answer and pay out to the
 * team. If the budget cannot cover the answer (credits or badges exhausted),
 * the event is marked completed — it's over when the organizer runs out.
 */
async function applyRewardBudget(event, team, sub, scoreAwarded) {
  const budget = event.rewardBudget || {};
  const creditsPerCorrect = Number(budget.creditsPerCorrect) || 0;
  const badgesPerCorrect = Number(budget.badgesPerCorrect) || 0;
  const badgeId = budget.badgeId || null;
  const maxCredits = Number(budget.maxCredits) || 0;
  const maxBadges = Number(budget.maxBadges) || 0;

  const members = await prisma.eventTeamMember.findMany({
    where: { teamId: team.id },
    select: { userId: true }
  });
  const memberCount = Math.max(members.length, 1);

  const creditsCost = creditsPerCorrect * memberCount;
  const badgesCost = (badgeId ? badgesPerCorrect : 0) * memberCount;

  const creditsLeft = maxCredits - (event.rewardCreditsSpent || 0);
  const badgesLeft = maxBadges - (event.rewardBadgesSpent || 0);

  // Budget can't cover this answer → no payout, event is over.
  if (creditsCost > creditsLeft || badgesCost > badgesLeft) {
    await prisma.event.update({
      where: { id: event.id },
      data: { status: 'completed' }
    });
    return;
  }

  const rewardRef = `event_auto_${event.id}_${sub.id}`;

  for (const m of members) {
    if (creditsCost > 0) {
      await prisma.user.update({
        where: { id: m.userId },
        data: { creditBalance: { increment: creditsPerCorrect } }
      });
      await prisma.transaction.create({
        data: {
          receiverId: m.userId,
          amount: creditsPerCorrect,
          type: 'event_reward',
          referenceId: rewardRef
        }
      });
    }
    if (badgeId && badgesPerCorrect > 0) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: m.userId, badgeId } },
        update: {},
        create: { userId: m.userId, badgeId, source: 'event' }
      });
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      rewardCreditsSpent: event.rewardCreditsSpent + creditsCost,
      rewardBadgesSpent: event.rewardBadgesSpent + badgesCost
    }
  });

  const creditsNowLeft = (maxCredits - (event.rewardCreditsSpent + creditsCost)) <= 0;
  const badgesNowLeft = (maxBadges - (event.rewardBadgesSpent + badgesCost)) <= 0;
  const hasCreditBudget = maxCredits > 0;
  const hasBadgeBudget = maxBadges > 0;
  if ((hasCreditBudget && creditsNowLeft) || (hasBadgeBudget && badgesNowLeft)) {
    await prisma.event.update({
      where: { id: event.id },
      data: { status: 'completed' }
    });
  }
}

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
    const { status, scoreAwarded } = req.body;

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

    return success(res, updated);
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

    const leaderboard = teams.map(team => {
       let totalScore = team.points; // Any legacy base points
       let history = [];

       team.submissions.forEach(sub => {
         if (sub.status === 'correct') {
            let taskScore = sub.scoreAwarded;
            if (sub.task.isDynamicScore) {
               const elapsedMinutes = (new Date(sub.submittedAt).getTime() - new Date(event.startDate).getTime()) / 60000;
               if (elapsedMinutes > 0) {
                 const penalty = sub.task.basePoints * (sub.task.decayPercentage / 100) * elapsedMinutes;
                 taskScore = Math.max(sub.task.basePoints * 0.1, sub.task.basePoints - penalty); // floor at 10%
               }
            }
            totalScore += taskScore;
            history.push({ type: 'submission', taskId: sub.taskId, taskTitle: sub.task.title, scoreChange: Math.round(taskScore), date: sub.submittedAt, status: 'correct' });
         } else if (sub.status === 'wrong') {
             // deduct penalty
             const penalty = sub.task.wrongSubmissionPenalty + event.wrongSubmissionPenalty;
             totalScore -= penalty;
             history.push({ type: 'submission', taskId: sub.taskId, taskTitle: sub.task.title, scoreChange: -penalty, date: sub.submittedAt, status: 'wrong' });
         }
       });

       team.pointAdjustments?.forEach(adj => {
          totalScore += adj.pointsAdded;
          history.push({ type: 'adjustment', reason: adj.reason, awardedBy: adj.awardedBy?.displayName, scoreChange: adj.pointsAdded, date: adj.createdAt });
       });

       history.sort((a,b) => new Date(b.date) - new Date(a.date));

       return { id: team.id, name: team.name, score: Math.round(totalScore), history };
    });

    leaderboard.sort((a, b) => b.score - a.score);

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
    const { credits, badgeId } = req.body;

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id) || req.user.globalRing === 0;
    if (!isOrganizer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can award rewards.' } });

    const team = await prisma.eventTeam.findUnique({ where: { id: teamId }, include: { members: true } });
    if (!team || team.eventId !== eventId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Team not found in this event.' } });
    }

    // Idempotency guard: an organizer may award an ad-hoc reward to a team
    // only ONCE per event — otherwise credits/badges can be minted infinitely.
    const rewardRef = `event_reward_${eventId}_${teamId}`;
    const existingReward = await prisma.transaction.findFirst({
      where: { type: 'event_reward', referenceId: rewardRef },
      select: { id: true },
    });
    if (existingReward) {
      return res.status(409).json({ error: { code: 'ALREADY_REWARDED', message: 'This team has already received rewards for this event.' } });
    }

    const results = [];

    for (const member of team.members) {
      if (credits && credits > 0) {
        await prisma.user.update({
          where: { id: member.userId },
          data: { creditBalance: { increment: credits } }
        });
        await prisma.transaction.create({
          data: {
            receiverId: member.userId,
            amount: credits,
            type: 'event_reward',
            referenceId: rewardRef
          }
        });
      }

      if (badgeId) {
        await prisma.userBadge.upsert({
          where: { userId_badgeId: { userId: member.userId, badgeId } },
          update: {},
          create: { userId: member.userId, badgeId, source: 'event' }
        });
      }

      results.push({ userId: member.userId, credits: credits || 0, badgeId: badgeId || null });
    }

    return success(res, { teamId, rewards: results }, 201);
  } catch (err) { next(err); }
};

exports.distributeRewards = async (req, res, next) => {
  try {
    const { id: eventId } = req.params;

    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { organizers: true } });
    if (!event) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found.' } });

    const isOrganizer = event.creatorId === req.user.id || event.organizers.some(o => o.userId === req.user.id) || req.user.globalRing === 0;
    if (!isOrganizer) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only organizers can distribute rewards.' } });

    const rewardTiers = event.rewardTiers;
    if (!rewardTiers || !Array.isArray(rewardTiers) || rewardTiers.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No reward tiers configured for this event.' } });
    }

    // Idempotency guard: rewards can be distributed only ONCE per event.
    const distributionRef = `event_distribute_${eventId}`;
    const existing = await prisma.transaction.findFirst({
      where: { type: 'event_reward', referenceId: distributionRef },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: { code: 'ALREADY_DISTRIBUTED', message: 'Rewards for this event have already been distributed.' } });
    }

    // Build leaderboard to determine ranks
    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      include: { submissions: { include: { task: true } }, pointAdjustments: true, members: true }
    });

    const leaderboard = teams.map(team => {
      let totalScore = team.points;
      team.submissions.forEach(sub => {
        if (sub.status === 'correct') totalScore += sub.scoreAwarded;
        else if (sub.status === 'wrong') totalScore -= (sub.task.wrongSubmissionPenalty + event.wrongSubmissionPenalty);
      });
      team.pointAdjustments?.forEach(adj => { totalScore += adj.pointsAdded; });
      return { id: team.id, name: team.name, score: Math.round(totalScore), members: team.members };
    });

    leaderboard.sort((a, b) => b.score - a.score);

    const distributed = [];

    for (const tier of rewardTiers) {
      const rankIndex = tier.rank - 1;
      const team = leaderboard[rankIndex];
      if (!team) continue;

      for (const member of team.members) {
        if (tier.credits && tier.credits > 0) {
          await prisma.user.update({
            where: { id: member.userId },
            data: { creditBalance: { increment: tier.credits } }
          });
          await prisma.transaction.create({
            data: { receiverId: member.userId, amount: tier.credits, type: 'event_reward', referenceId: distributionRef }
          });
        }
        if (tier.badgeId) {
          await prisma.userBadge.upsert({
            where: { userId_badgeId: { userId: member.userId, badgeId: tier.badgeId } },
            update: {},
            create: { userId: member.userId, badgeId: tier.badgeId, source: 'event' }
          });
        }
      }

      distributed.push({ rank: tier.rank, teamId: team.id, teamName: team.name, credits: tier.credits || 0, badgeId: tier.badgeId || null });
    }

    return success(res, { distributed });
  } catch (err) { next(err); }
};
