/**
 * Seed Service
 * 
 * Creates the Seed Admin (Ring 0) on first boot using environment variables.
 * This is the FIRST user in the system and has full platform control.
 * 
 * The seed process is IDEMPOTENT — running it again is safe and will
 * not create duplicate accounts.
 */

const prisma = require('../prisma');
const env = require('../config/env');
const { hashPassword } = require('../utils/password');

/**
 * Seed the admin user if no Ring 0 user exists in the database.
 * Also ensures the InstitutionConfig singleton document exists.
 */
async function seedAdmin() {
  try {
    // Check if any Ring 0 user already exists
    const existingAdmin = await prisma.user.findFirst({
      where: { globalRing: 0 },
    });

    if (existingAdmin) {
      console.log(`[SEED] Seed Admin already exists: ${existingAdmin.email}`);
      return;
    }

    // Validate that seed credentials are provided
    if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
      console.error('[SEED] ❌ SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in environment variables.');
      console.error('[SEED] Cannot create Seed Admin. Exiting.');
      process.exit(1);
    }
    if (typeof env.SEED_ADMIN_PASSWORD !== 'string' || env.SEED_ADMIN_PASSWORD.length < 12) {
      console.error('[SEED] ❌ SEED_ADMIN_PASSWORD must be at least 12 characters.');
      console.error('[SEED] Refusing to create a Ring 0 admin with a weak password. Exiting.');
      process.exit(1);
    }

    // Create the Seed Admin user (Ring 0)
    const hashedPassword = await hashPassword(env.SEED_ADMIN_PASSWORD);
    const admin = await prisma.user.create({
      data: {
        email: env.SEED_ADMIN_EMAIL,
        password: hashedPassword,
        displayName: env.SEED_ADMIN_DISPLAY_NAME,
        globalRing: 0, // Ring 0 = Admin
        cohortTags: [],
        displayBadges: [],
      },
    });

    console.log(`[SEED] ✅ Seed Admin created: ${admin.email} (Ring 0)`);

    // Ensure InstitutionConfig singleton exists
    const configCount = await prisma.institutionConfig.count();
    if (configCount === 0) {
      await prisma.institutionConfig.create({
        data: {
          name: 'Unconfigured Institution',
          domain: '',
          isConfigured: false,
        },
      });
      console.log('[SEED] ✅ InstitutionConfig document created (awaiting admin setup).');
    }
  } catch (err) {
    console.error('[SEED] ❌ Failed to seed admin:', err.message);
    throw err;
  }
}

module.exports = { seedAdmin };
