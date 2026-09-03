/**
 * start-with-db.js — Zero-Config Comflex Backend Launcher
 *
 * Automatically launches a persistent local MongoDB Replica Set,
 * seeds the platform admin, and boots Express + Socket.IO on PORT 5001.
 */

const path = require('path');
const fs = require('fs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

async function main() {
  console.log('\n========================================');
  console.log('🚀 Launching Comflex Backend with Local DB');
  console.log('========================================\n');

  // 1. Ensure persistent database folder
  const dbDir = path.resolve(__dirname, '../.db_data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  let dbUri = process.env.DATABASE_URL;

  if (!dbUri) {
    console.log('📦 Starting persistent local MongoDB replica set...');
    try {
      const replSet = await MongoMemoryReplSet.create({
        replSet: {
          count: 1,
          storageEngine: 'wiredTiger',
        },
        instanceOpts: [
          {
            dbPath: dbDir,
          },
        ],
      });

      dbUri = replSet.getUri('comflex');
      console.log(`✅ MongoDB Replica Set active: ${dbUri}`);

      process.on('SIGINT', async () => {
        await replSet.stop();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await replSet.stop();
        process.exit(0);
      });
    } catch (err) {
      console.warn('Falling back to dynamic memory replica set:', err.message);
      const replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
      });
      dbUri = replSet.getUri('comflex');
      console.log(`✅ Dynamic MongoDB Replica Set active: ${dbUri}`);
    }
  }

  // 2. Set environment variables
  process.env.DATABASE_URL = dbUri;
  process.env.PORT = process.env.PORT || '5001';
  process.env.NODE_ENV = 'development';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-comflex-jwt-2026';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-comflex-jwt-2026';
  process.env.SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.edu';
  process.env.SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'change-me-1234';
  process.env.SEED_ADMIN_DISPLAY_NAME = process.env.SEED_ADMIN_DISPLAY_NAME || 'Platform Admin';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';

  // 3. Write / update backend/.env
  const envContent = `PORT=${process.env.PORT}\nNODE_ENV=development\nDATABASE_URL="${dbUri}"\nJWT_ACCESS_SECRET="${process.env.JWT_ACCESS_SECRET}"\nJWT_REFRESH_SECRET="${process.env.JWT_REFRESH_SECRET}"\nSEED_ADMIN_EMAIL="${process.env.SEED_ADMIN_EMAIL}"\nSEED_ADMIN_PASSWORD="${process.env.SEED_ADMIN_PASSWORD}"\nSEED_ADMIN_DISPLAY_NAME="${process.env.SEED_ADMIN_DISPLAY_NAME}"\nFRONTEND_URL="${process.env.FRONTEND_URL}"\nEMAIL_PROVIDER=console\n`;
  fs.writeFileSync(path.resolve(__dirname, '../.env'), envContent, 'utf8');

  // 4. Start the server
  console.log('🌟 Booting Express & Socket.IO server on PORT 5001...');
  require('./index.js');
}

main().catch((err) => {
  console.error('❌ Fatal error launching backend:', err);
  process.exit(1);
});
