/**
 * User Service
 * 
 * Business logic for user profile management: get profile,
 * update profile, update avatar, admin operations.
 */

const prisma = require('../prisma');
const { sanitizeUser } = require('./authService');
const { deleteStoredFile } = require('../utils/fileStorage');

/**
 * Get a user's full profile by ID.
 */
async function getUserById(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'USER_NOT_FOUND' });
  return sanitizeUser(user);
}

/**
 * Update a user's profile fields (displayName, bio, displayBadges, cfHandle).
 * Only the user themselves or an Admin can do this.
 */
async function updateProfile(userId, updates) {
  // Whitelist allowed fields
  const allowed = {};
  if (updates.displayName !== undefined) {
    allowed.displayName = String(updates.displayName).trim().substring(0, 50);
  }
  if (updates.bio !== undefined) {
    allowed.bio = String(updates.bio).substring(0, 500); // Max 500 chars
  }
  if (updates.displayBadges !== undefined) {
    // Max 5 display badges — and only badges the user actually owns, preserving custom ordering.
    const requested = (Array.isArray(updates.displayBadges) ? updates.displayBadges : [])
      .slice(0, 5)
      .filter((id) => typeof id === 'string');
    const owned = await prisma.userBadge.findMany({
      where: { userId, badgeId: { in: requested } },
      select: { badgeId: true },
    });
    const ownedSet = new Set(owned.map((b) => b.badgeId));
    allowed.displayBadges = requested.filter((id) => ownedSet.has(id));
  }
  if (updates.cfHandle !== undefined) {
    allowed.cfHandle = updates.cfHandle ? String(updates.cfHandle).trim() : null;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: allowed,
  });

  return sanitizeUser(user);
}

/**
 * Update a user's avatar URL and clean up the old avatar file if applicable.
 */
async function updateAvatar(userId, avatarUrl) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  if (existing?.avatarUrl && existing.avatarUrl !== avatarUrl) {
    try {
      await deleteStoredFile(existing.avatarUrl);
    } catch {
      // Non-critical file cleanup failure
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
  });
  return sanitizeUser(user);
}

/**
 * Admin: list all users with optional search/filter.
 */
async function listUsers({ search, ring, page = 1, limit = 20 }) {
  const where = {};

  // Optional search by email, username, or displayName
  if (search && search.trim()) {
    const term = search.trim();
    where.OR = [
      { email: { contains: term, mode: 'insensitive' } },
      { displayName: { contains: term, mode: 'insensitive' } },
      { username: { contains: term, mode: 'insensitive' } },
    ];
  }

  // Optional filter by global ring
  if (ring !== undefined && ring !== '' && !isNaN(Number(ring))) {
    where.globalRing = parseInt(ring, 10);
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map(sanitizeUser),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Admin: change a user's global ring level.
 */
async function setUserRing(userId, newRing) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { globalRing: newRing },
  });
  return sanitizeUser(user);
}

module.exports = { getUserById, updateProfile, updateAvatar, listUsers, setUserRing };
