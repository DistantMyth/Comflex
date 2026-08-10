const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const prisma = require('../prisma');
const { success, error } = require('../utils/apiResponse');
const { storeFile } = require('../utils/fileStorage');
const { ethers } = require('ethers');

const router = express.Router();
router.use(authMiddleware);

const uploadDir = env.STORAGE_PATH;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `badge-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, SVG and WebP images are allowed.'));
    }
  },
});

// ==========================================
// STORE & BADGES
// ==========================================

// Get STORE CONFIG & PRICING
router.get('/config', async (req, res, next) => {
  try {
    const config = await prisma.institutionConfig.findFirst();
    const defaults = {
      proWeekly: 50, proMonthly: 150, proYearly: 1500,
      ultraWeekly: 100, ultraMonthly: 300, ultraYearly: 3000,
      creditEthPrice: { 100: 0.01, 500: 0.045, 2000: 0.15 }
    };
    return success(res, config?.membershipConfig || defaults);
  } catch (err) {
    next(err);
  }
});

// Get all badges
router.get('/badges', async (req, res, next) => {
  try {
    const badges = await prisma.badge.findMany();
    return success(res, badges);
  } catch (err) {
    next(err);
  }
});

// Get all active store listings
router.get('/listings', async (req, res, next) => {
  try {
    const listings = await prisma.storeListing.findMany({
      include: { badge: true },
      orderBy: { createdAt: 'desc' }
    });
    return success(res, listings);
  } catch (err) {
    next(err);
  }
});

// Admin: Create a badge
router.post('/admin/badges', upload.single('image'), [
  body('name').notEmpty(),
  body('description').notEmpty()
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400);

    const { name, description, isEventBadge } = req.body;
    let imageUrl = req.body.imageUrl;
    
    if (req.file) {
      imageUrl = await storeFile(req.file, { folder: 'comflex/badges' });
    }
    
    if (!imageUrl) return error(res, 'VALIDATION', 'Image URL or file is required', 400);
    
    const badge = await prisma.badge.create({
      data: { name, description, imageUrl, isEventBadge: isEventBadge === 'true' || isEventBadge === true }
    });
    return success(res, badge, 201);
  } catch (err) {
    next(err);
  }
});

// Admin: Create store listing
router.post('/admin/listings', [
  body('badgeId').notEmpty(),
  body('price').isInt({ min: 0 }),
  body('quantity').isInt() // -1 for infinite
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);

    const { badgeId, price, quantity } = req.body;
    const badge = await prisma.badge.findUnique({ where: { id: badgeId } });
    if (!badge || badge.isEventBadge) return error(res, 'VALIDATION', 'Invalid badge or badge is an event badge', 400);

    const listing = await prisma.storeListing.create({
      data: { badgeId, price, quantity }
    });
    return success(res, listing, 201);
  } catch (err) {
    next(err);
  }
});

// Admin: Mint credits for a user
router.post('/admin/mint-credits', [
  body('userId').notEmpty(),
  body('amount').isInt({ min: 1 })
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0) return error(res, 'FORBIDDEN', 'Admin only', 403);
    const { userId, amount } = req.body;

    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: userId },
          { email: userId },
          ...(userId.match(/^[0-9a-fA-F]{24}$/) ? [{ id: userId }] : [])
        ]
      }
    });

    if (!targetUser) {
      return error(res, 'NOT_FOUND', 'User not found. Try exact ID, username, or email.', 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: targetUser.id }, data: { creditBalance: { increment: amount } } });
      await tx.transaction.create({
        data: { senderId: null, receiverId: targetUser.id, amount, type: 'transfer' }
      });
    });
    return success(res, { message: 'Credits minted' });
  } catch (err) {
    next(err);
  }
});

// Purchase a badge
router.post('/purchase', [
  body('listingId').notEmpty()
], async (req, res, next) => {
  try {
    const { listingId } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const listing = await prisma.storeListing.findUnique({ where: { id: listingId }, include: { badge: true } });

    if (!listing) return error(res, 'NOT_FOUND', 'Listing not found', 404);
    if (listing.quantity !== -1 && listing.sold >= listing.quantity) return error(res, 'VALIDATION', 'Sold out', 400);
    if (user.globalRing !== 0 && user.creditBalance < listing.price) return error(res, 'VALIDATION', 'Insufficient credits', 400);

    const alreadyOwns = await prisma.userBadge.findUnique({
      where: { userId_badgeId: { userId: user.id, badgeId: listing.badgeId } }
    });
    if (alreadyOwns) return error(res, 'VALIDATION', 'You already own this badge', 400);

    // Perform transaction
    await prisma.$transaction(async (tx) => {
      // 1. Deduct credits
      if (user.globalRing !== 0) {
        await tx.user.update({
          where: { id: user.id },
          data: { creditBalance: { decrement: listing.price } }
        });
      }
      // 2. Increment sold count
      await tx.storeListing.update({
        where: { id: listing.id },
        data: { sold: { increment: 1 } }
      });
      // 3. Grant Badge
      await tx.userBadge.create({
        data: { userId: user.id, badgeId: listing.badgeId, source: 'store' }
      });
      // 4. Create Ledger Record
      await tx.transaction.create({
        data: {
          senderId: user.id,
          receiverId: user.id, // self transaction or system (could be null sender, but receiver is system? Let's use receiverId=user with system transfer type)
          amount: listing.price,
          type: 'purchase',
          referenceId: listing.id
        }
      });
    });

    return success(res, { message: 'Purchase successful' });
  } catch (err) {
    next(err);
  }
});

// Get user's inventory
router.get('/inventory', async (req, res, next) => {
  try {
    const inventory = await prisma.userBadge.findMany({
      where: { userId: req.user.id },
      include: { badge: true }
    });
    return success(res, inventory);
  } catch (err) {
    next(err);
  }
});

// Set display badges
router.post('/display-badges', [
  body('badgeIds').isArray({ max: 5 })
], async (req, res, next) => {
  try {
    const { badgeIds } = req.body;
    
    // Verify user owns all requested badges
    const owned = await prisma.userBadge.findMany({
      where: { userId: req.user.id, badgeId: { in: badgeIds } }
    });
    
    if (owned.length !== badgeIds.length) {
      return error(res, 'VALIDATION', 'You do not own all these badges', 400);
    }
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { displayBadges: badgeIds }
    });
    
    return success(res, { message: 'Display badges updated', displayBadges: user.displayBadges });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// LEDGER & CREDITS & MEMBERSHIPS
// ==========================================

const { syncMembership } = require('../utils/membershipSync');

// Purchase Membership (Using Credits)
router.post('/buy-membership', [
  body('tier').isIn(['pro', 'ultra']),
  body('duration').isIn(['weekly', 'monthly', 'yearly'])
], async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400);

    const { tier, duration } = req.body;
    let user = await prisma.user.findUnique({ where: { id: req.user.id } });
    
    // Sync membership states before continuing logic
    user = await syncMembership(user);

    // DURATION & TIER WEIGHT CONSTANTS
    const TIER_WEIGHT = { free: 0, pro: 1, ultra: 2 };
    const DUR_WEIGHT = { weekly: 1, monthly: 2, yearly: 3 };

    // --- RULE 2: Downgrade Lock on Tiers ---
    // If the user currently has an active plan that is HIGHER than the requested plan, block it.
    if (user.subscriptionPlan && user.subscriptionExpiry && user.subscriptionExpiry > new Date()) {
      const curTierWeight = TIER_WEIGHT[user.subscriptionPlan] || 0;
      const newTierWeight = TIER_WEIGHT[tier] || 0;

      if (curTierWeight > newTierWeight) {
         return error(res, 'VALIDATION', `You cannot buy a ${tier.toUpperCase()} plan while your ${user.subscriptionPlan.toUpperCase()} plan is still active.`, 403);
      }

      // --- RULE 1: Duration Lock (Same Tier) ---
      // If it's the exact same tier, we cannot downgrade the *duration*.
      // We check their latest purchase transaction to find their active duration.
      if (curTierWeight === newTierWeight) {
        const lastTx = await prisma.transaction.findFirst({
          where: { receiverId: user.id, type: 'purchase', tier: user.subscriptionPlan },
          orderBy: { createdAt: 'desc' }
        });

        if (lastTx && lastTx.duration) {
          const curDurWeight = DUR_WEIGHT[lastTx.duration] || 0;
          const newDurWeight = DUR_WEIGHT[duration] || 0;

          if (curDurWeight >= newDurWeight) {
             return error(res, 'VALIDATION', `You already have an active ${lastTx.duration.toUpperCase()} plan. You cannot buy the same or lower duration until it expires.`, 403);
          }
        }
      }
    }

    // Dynamic Price Matrix
    const config = await prisma.institutionConfig.findFirst();
    const mConfig = config?.membershipConfig || {
      proWeekly: 50, proMonthly: 150, proYearly: 1500,
      ultraWeekly: 100, ultraMonthly: 300, ultraYearly: 3000
    };
    
    // Format key matching config structure: proWeekly, ultraMonthly
    const priceKey = `${tier}${duration.charAt(0).toUpperCase() + duration.slice(1)}`;
    const cost = parseInt(mConfig[priceKey], 10);
    
    if (isNaN(cost)) {
      return error(res, 'SERVER_ERROR', 'Membership pricing configuration error.', 500);
    }

    if (user.globalRing !== 0 && user.creditBalance < cost) {
      return error(res, 'VALIDATION', `Insufficient balance. Requires ${cost} credits.`, 400);
    }

    const now = new Date();
    let expiryDate = new Date(now);
    
    // If extending the EXACT same plan and duration, append to the current expiry date
    if (user.subscriptionPlan === tier && user.subscriptionExpiry && user.subscriptionExpiry > now) {
       expiryDate = new Date(user.subscriptionExpiry);
    }

    if (duration === 'weekly') expiryDate.setDate(expiryDate.getDate() + 7);
    if (duration === 'monthly') expiryDate.setMonth(expiryDate.getMonth() + 1);
    if (duration === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    // --- RULE 3: Temporary Upgrade Overlap (Stacking) ---
    let newBackupPlan = user.backupSubscriptionPlan;
    let newBackupExpiry = user.backupSubscriptionExpiry;
    
    // If upgrading to a HIGHER tier (e.g. Pro -> Ultra) while their current is valid
    if (
        user.subscriptionPlan && 
        user.subscriptionPlan !== 'free' && 
        user.subscriptionPlan !== tier && 
        user.subscriptionExpiry > now
    ) {
       // Save their current active lower tier in the background!
       newBackupPlan = user.subscriptionPlan;
       newBackupExpiry = user.subscriptionExpiry;
    }

    await prisma.$transaction(async (ptx) => {
      const updatePayload = {
        subscriptionPlan: tier,
        subscriptionExpiry: expiryDate,
        backupSubscriptionPlan: newBackupPlan,
        backupSubscriptionExpiry: newBackupExpiry
      };

      if (user.globalRing !== 0) {
        updatePayload.creditBalance = { decrement: cost };
      }

      await ptx.user.update({
        where: { id: req.user.id },
        data: updatePayload
      });

      await ptx.transaction.create({
        data: {
          senderId: req.user.id,
          receiverId: req.user.id,
          amount: cost,
          type: 'purchase',
          referenceId: `membership_${tier}_${duration}`,
          tier,
          duration
        }
      });
    });

    return success(res, { message: 'Membership active!', tier, expiryDate });
  } catch (err) {
    next(err);
  }
});

// Buy Credits (Crypto)
router.post('/buy-credits', [
  body('txHash').notEmpty(),
  body('amount').isInt({ min: 1 })
], async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400);

    const { txHash, amount } = req.body;
    const treasury = process.env.TREASURY_ADDRESS;
    if (!treasury) return error(res, 'SERVER_ERROR', 'Treasury address not configured', 500);

    // Verify it hasn't been used
    const existingTx = await prisma.transaction.findFirst({ where: { referenceId: txHash, type: 'crypto_purchase' } });
    if (existingTx) return error(res, 'DUPLICATE', 'Transaction hash already claimed', 400);

    // Verify against dynamic pricing config
    const config = await prisma.institutionConfig.findFirst();
    const creditEthPrice = config?.membershipConfig?.creditEthPrice || {
      100: 0.01, 500: 0.045, 2000: 0.15
    };
    
    // If the exact tier package isn't directly defined, this acts as a hard limit unless admin extends pricing manually
    const expectedEth = creditEthPrice[amount];
    
    // Validate using ethers on Sepolia
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const tx = await provider.getTransaction(txHash);

    if (!tx) return error(res, 'NOT_FOUND', 'Transaction not found on network', 404);
    if (tx.to?.toLowerCase() !== treasury.toLowerCase()) {
      return error(res, 'VALIDATION', 'Transaction was not sent to the Treasury Address', 400);
    }
    
    if (expectedEth) {
       const actualEth = Number(ethers.formatEther(tx.value));
       if (actualEth < expectedEth) {
         return error(res, 'VALIDATION', `Transaction value (${actualEth} ETH) is lower than required (${expectedEth} ETH) for ${amount} Credits.`, 400);
       }
    }

    await prisma.$transaction(async (ptx) => {
      await ptx.user.update({
        where: { id: req.user.id },
        data: { creditBalance: { increment: amount } }
      });

      await ptx.transaction.create({
        data: {
          senderId: req.user.id,
          receiverId: req.user.id,
          amount: amount,
          cryptoAmount: ethers.formatEther(tx.value),
          type: 'crypto_purchase',
          referenceId: txHash
        }
      });
    });

    return success(res, { message: `${amount} Credits purchased successfully!` });
  } catch (err) {
    next(err);
  }
});

// Transfer credits
router.post('/transfer', [
  body('receiverId').notEmpty(),
  body('amount').isInt({ min: 1 })
], async (req, res, next) => {
  try {
    const { receiverId, amount } = req.body;
    const senderId = req.user.id;

    if (senderId === receiverId) return error(res, 'VALIDATION', 'Cannot transfer to yourself', 400);

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (sender.globalRing !== 0 && sender.creditBalance < amount) return error(res, 'VALIDATION', 'Insufficient credits', 400);

    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver) return error(res, 'NOT_FOUND', 'Receiver not found', 404);

    await prisma.$transaction(async (tx) => {
      // 1. Deduct sender
      if (sender.globalRing !== 0) {
        await tx.user.update({ where: { id: senderId }, data: { creditBalance: { decrement: amount } } });
      }
      // 2. Add receiver
      await tx.user.update({ where: { id: receiverId }, data: { creditBalance: { increment: amount } } });
      // 3. Create Ledger Record
      await tx.transaction.create({
        data: { senderId, receiverId, amount, type: 'transfer' }
      });
    });

    return success(res, { message: 'Transfer successful' });
  } catch (err) {
    next(err);
  }
});

// Get user credit balance and transaction history
router.get('/ledger', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [{ senderId: req.user.id }, { receiverId: req.user.id }]
      },
      include: {
        sender: { select: { id: true, displayName: true, username: true } },
        receiver: { select: { id: true, displayName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return success(res, { balance: user.creditBalance, transactions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
