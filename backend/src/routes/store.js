const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const authMiddleware = require('../middleware/auth');
const prisma = require('../prisma');
const { success, error } = require('../utils/apiResponse');
const { storeFile, deleteStoredFile } = require('../utils/fileStorage');
const { validateStoredFile } = require('../utils/fileMagic');
const { ethers } = require('ethers');

const router = express.Router();
router.use(authMiddleware);

// Sepolia is the only network buy-credits accepts — a payment on any other
// chain for the same treasury address must not mint credits.
const ACCEPTED_CHAIN_ID = 11155111;
const WALLET_NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes to sign a challenge

// ==========================================
// WALLET BINDING (required before buy-credits)
// ==========================================
// Credits are only credited to the account whose stored wallet address
// matches the transaction's `from` — otherwise anyone could claim someone
// else's payment by watching the mempool. Binding requires a signed
// message (EIP-191) proving control of the address.

// Step 1: get a short-lived nonce to sign.
router.post('/wallet/challenge', async (req, res, next) => {
  try {
    const nonce = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: req.user.id },
      data: { walletNonce: nonce, walletNonceExpiry: new Date(Date.now() + WALLET_NONCE_TTL_MS) },
    });
    return success(res, { nonce }, 201);
  } catch (err) {
    next(err);
  }
});

// Step 2: prove ownership of `address` by signing the nonce.
router.post('/wallet', [
  body('address').isEthereumAddress().withMessage('Valid Ethereum address required.'),
  body('signature').isString().notEmpty().withMessage('Signature required.')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());

    const { address, signature } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user.walletNonce || !user.walletNonceExpiry || new Date() > user.walletNonceExpiry) {
      return error(res, 'CHALLENGE_EXPIRED', 'Wallet challenge has expired. Request a new challenge nonce.', 400);
    }

    const message = `Comflex wallet binding\n\nNonce: ${user.walletNonce}\nAccount: ${user.id}`;
    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch {
      return error(res, 'INVALID_SIGNATURE', 'Could not verify wallet signature.', 400);
    }

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return error(res, 'SIGNATURE_MISMATCH', 'Signature does not match the provided wallet address.', 400);
    }

    // Check if address is already registered to a different account
    const existingBinding = await prisma.user.findFirst({
      where: {
        walletAddress: { equals: address.toLowerCase(), mode: 'insensitive' },
        id: { not: req.user.id }
      }
    });
    if (existingBinding) {
      return error(res, 'WALLET_IN_USE', 'This wallet address is already bound to another account.', 409);
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        walletAddress: address.toLowerCase(),
        walletNonce: null,
        walletNonceExpiry: null,
      }
    });

    return success(res, { message: 'Wallet bound successfully.', walletAddress: address.toLowerCase() });
  } catch (err) {
    next(err);
  }
});

// Get user credit ledger / history
router.get('/ledger', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { creditBalance: true }
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { senderId: req.user.id },
          { receiverId: req.user.id }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sender: { select: { id: true, username: true, displayName: true } },
        receiver: { select: { id: true, username: true, displayName: true } }
      }
    });

    return success(res, { balance: user.creditBalance, transactions });
  } catch (err) {
    next(err);
  }
});

// Transfer credits to another user
router.post('/transfer', [
  body('receiverId').notEmpty().withMessage('Receiver ID, username, or email is required.'),
  body('amount').isInt({ min: 1, max: 1000000 }).withMessage('Transfer amount must be between 1 and 1,000,000 credits.')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());

    const { receiverId, amount } = req.body;
    const cleanReceiver = typeof receiverId === 'string' ? receiverId.trim() : '';

    if (!cleanReceiver) {
      return error(res, 'VALIDATION', 'Receiver identifier is required.', 400);
    }

    const receiver = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanReceiver },
          { email: cleanReceiver },
          ...(cleanReceiver.match(/^[0-9a-fA-F]{24}$/) ? [{ id: cleanReceiver }] : [])
        ]
      }
    });

    if (!receiver) {
      return error(res, 'NOT_FOUND', 'Recipient user not found.', 404);
    }

    if (receiver.id === req.user.id) {
      return error(res, 'INVALID_TRANSFER', 'Cannot transfer credits to yourself.', 400);
    }

    await prisma.$transaction(async (tx) => {
      const deductionResult = await tx.user.updateMany({
        where: {
          id: req.user.id,
          creditBalance: { gte: amount }
        },
        data: {
          creditBalance: { decrement: amount }
        }
      });

      if (deductionResult.count === 0) {
        throw Object.assign(new Error('Insufficient credit balance.'), { code: 'INSUFFICIENT_CREDITS', statusCode: 400 });
      }

      await tx.user.update({
        where: { id: receiver.id },
        data: { creditBalance: { increment: amount } }
      });

      await tx.transaction.create({
        data: {
          senderId: req.user.id,
          receiverId: receiver.id,
          amount,
          type: 'transfer'
        }
      });
    });

    return success(res, { message: `Transferred ${amount} credits successfully.` });
  } catch (err) {
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

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
    // SVG excluded deliberately — SVG can contain scripts and is served
    // same-origin, making it a stored-XSS vector.
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF and WebP images are allowed.'));
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
      creditEthPrice: { 100: 0.01, 500: 0.045, 2000: 0.15 }
    };
    return success(res, config?.creditConfig || defaults);
  } catch (err) {
    next(err);
  }
});

// Get all badges
router.get('/badges', async (req, res, next) => {
  try {
    const badges = await prisma.badge.findMany({
      orderBy: { createdAt: 'desc' }
    });
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
  body('name').trim().notEmpty().withMessage('Badge name is required.'),
  body('description').trim().notEmpty().withMessage('Badge description is required.')
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());
    }

    const { name, description, isEventBadge } = req.body;

    const existingBadge = await prisma.badge.findUnique({ where: { name } });
    if (existingBadge) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      return error(res, 'CONFLICT', 'A badge with this name already exists.', 409);
    }

    let imageUrl = req.body.imageUrl;
    
    if (req.file) {
      if (req.file.mimetype.startsWith('image/') && !validateStoredFile(req.file.path, req.file.mimetype)) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return error(res, 'INVALID_FILE_TYPE', 'The uploaded file is not a valid image.', 400);
      }
      imageUrl = await storeFile(req.file, { folder: 'comflex/badges' });
    }
    
    if (!imageUrl) return error(res, 'VALIDATION', 'Image URL or file is required', 400);
    
    const badge = await prisma.badge.create({
      data: { name, description, imageUrl, isEventBadge: isEventBadge === 'true' || isEventBadge === true }
    });
    return success(res, badge, 201);
  } catch (err) {
    if (err.code === 'P2002') return error(res, 'CONFLICT', 'A badge with this name already exists.', 409);
    if (err.statusCode) return error(res, err.code, err.message, err.statusCode);
    next(err);
  }
});

// Admin: Delete a badge
router.delete('/admin/badges/:id', async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);

    const badge = await prisma.badge.findUnique({ where: { id: req.params.id } });
    if (!badge) return error(res, 'NOT_FOUND', 'Badge not found.', 404);

    // Check if actively listed in store
    const activeListings = await prisma.storeListing.count({ where: { badgeId: req.params.id } });
    if (activeListings > 0) {
      return error(res, 'CONFLICT', 'Please delist this badge from the store before deleting it.', 409);
    }

    // Check if owned by users
    const ownedCount = await prisma.userBadge.count({ where: { badgeId: req.params.id } });
    if (ownedCount > 0) {
      return error(res, 'CONFLICT', 'Cannot delete badge because it has already been awarded to or purchased by users.', 409);
    }

    // Delete stored image file
    if (badge.imageUrl) {
      try {
        await deleteStoredFile(badge.imageUrl);
      } catch { /* ignore non-fatal cleanup error */ }
    }

    await prisma.badge.delete({ where: { id: req.params.id } });
    return success(res, { message: `Badge "${badge.name}" deleted successfully.` });
  } catch (err) {
    if (err.code === 'P2025') return error(res, 'NOT_FOUND', 'Badge not found.', 404);
    next(err);
  }
});

// Admin: Create store listing
router.post('/admin/listings', [
  body('badgeId').isMongoId().withMessage('Invalid badge ID.'),
  body('price').isInt({ min: 0, max: 1000000 }).withMessage('Price must be between 0 and 1,000,000.'),
  body('quantity').isInt({ min: -1, max: 1000000 }).withMessage('Quantity must be between -1 and 1,000,000.') // -1 for infinite
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);

    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());

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

// Admin: Update store listing
router.patch('/admin/listings/:id', [
  body('price').optional().isInt({ min: 0, max: 1000000 }).withMessage('Price must be between 0 and 1,000,000.'),
  body('quantity').optional().isInt({ min: -1, max: 1000000 }).withMessage('Quantity must be between -1 and 1,000,000.')
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);

    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());

    const { price, quantity } = req.body;
    const updateData = {};
    if (price !== undefined) updateData.price = price;
    if (quantity !== undefined) updateData.quantity = quantity;

    const listing = await prisma.storeListing.update({
      where: { id: req.params.id },
      data: updateData,
    });
    return success(res, listing);
  } catch (err) {
    if (err.code === 'P2025') return error(res, 'NOT_FOUND', 'Listing not found.', 404);
    next(err);
  }
});

// Admin: Delete store listing (Delist)
router.delete('/admin/listings/:id', async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0 && !dbUser.canManageStore) return error(res, 'FORBIDDEN', 'Admin or Store Manager only', 403);

    await prisma.storeListing.delete({ where: { id: req.params.id } });
    return success(res, { message: 'Item delisted from store successfully.' });
  } catch (err) {
    if (err.code === 'P2025') return error(res, 'NOT_FOUND', 'Listing not found.', 404);
    next(err);
  }
});

// Admin: Mint credits for a user
router.post('/admin/mint-credits', [
  body('userId').notEmpty().withMessage('User ID, username, or email is required.'),
  body('amount').isInt({ min: 1, max: 1000000 }).withMessage('Amount must be between 1 and 1,000,000.')
], async (req, res, next) => {
  try {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser.globalRing !== 0) return error(res, 'FORBIDDEN', 'Admin only', 403);

    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errors.array());

    const { userId, amount } = req.body;
    const userQuery = typeof userId === 'string' ? userId.trim() : '';

    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: userQuery },
          { email: userQuery },
          ...(userQuery.match(/^[0-9a-fA-F]{24}$/) ? [{ id: userQuery }] : [])
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
  body('listingId').isMongoId().withMessage('Invalid listing ID.')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return error(res, 'VALIDATION', 'Invalid input.', 400, errors.array());

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

    // Perform transaction atomically
    await prisma.$transaction(async (tx) => {
      // 1. Deduct credits conditionally
      if (user.globalRing !== 0) {
        const debited = await tx.user.updateMany({
          where: { id: user.id, creditBalance: { gte: listing.price } },
          data: { creditBalance: { decrement: listing.price } }
        });
        if (debited.count === 0) {
          throw new Error('INSUFFICIENT_CREDITS');
        }
      }
      // 2. Increment sold count conditionally (prevent overselling)
      const updatedListing = await tx.storeListing.updateMany({
        where: {
          id: listing.id,
          OR: [
            { quantity: -1 },
            { sold: { lt: listing.quantity } }
          ]
        },
        data: { sold: { increment: 1 } }
      });
      if (updatedListing.count === 0) {
        throw new Error('SOLD_OUT');
      }

      // 3. Grant Badge
      await tx.userBadge.create({
        data: { userId: user.id, badgeId: listing.badgeId, source: 'store' }
      });
      // 4. Create Ledger Record — referenceId must be unique per purchase
      await tx.transaction.create({
        data: {
          senderId: user.id,
          receiverId: user.id,
          amount: listing.price,
          type: 'purchase',
          referenceId: `${listing.id}_${user.id}`
        }
      });
    });

    return success(res, { message: 'Purchase successful' });
  } catch (err) {
    if (err.code === 'P2002' || err.message === 'ALREADY_OWNED') {
      return error(res, 'VALIDATION', 'You already own this badge.', 400);
    }
    if (err.message === 'INSUFFICIENT_CREDITS') {
      return error(res, 'VALIDATION', 'Insufficient credits.', 400);
    }
    if (err.message === 'SOLD_OUT') {
      return error(res, 'VALIDATION', 'Listing is sold out.', 400);
    }
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
  body('badgeIds').isArray({ max: 5 }).custom((v) => {
    if (!Array.isArray(v)) return false;
    return v.every(id => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));
  }).withMessage('Each badge ID must be a valid ObjectId.')
], async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Invalid badge IDs.', 400, errs.array());

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
// LEDGER & CREDITS
// ==========================================

// Buy Credits (Crypto)
router.post('/buy-credits', [
  body('txHash').isString().notEmpty().withMessage('txHash is required.'),
  body('amount').isInt({ min: 1, max: 100000 }).withMessage('amount must be between 1 and 100,000.')
], async (req, res, next) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return error(res, 'VALIDATION', 'Invalid data', 400, errs.array());

    const { txHash, amount } = req.body;
    const treasury = process.env.TREASURY_ADDRESS;
    if (!treasury) return error(res, 'SERVER_ERROR', 'Treasury address not configured', 500);

    // The payer must have bound their wallet to this account first — the
    // transaction's `from` MUST match it. Without this check, anyone could
    // claim a payment they saw land in the treasury mempool.
    const claimer = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!claimer.walletAddress) {
      return error(res, 'VALIDATION', 'Bind your wallet to this account before purchasing credits.', 400);
    }

    // Verify against dynamic pricing config
    const config = await prisma.institutionConfig.findFirst();
    const creditEthPrice = config?.creditConfig?.creditEthPrice || {
      100: 0.01, 500: 0.045, 2000: 0.15
    };

    // The amount MUST be a listed tier — otherwise the expected value check
    // would be skipped entirely, letting anyone mint free credits with a
    // zero-value transaction.
    const expectedEth = creditEthPrice[amount];
    if (expectedEth === undefined) {
      return error(res, 'VALIDATION', `Amount ${amount} is not a valid credit package.`, 400);
    }

    // Validate using ethers on Sepolia
    const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl, 11155111, { staticNetwork: true });
    const tx = await provider.getTransaction(txHash);

    if (!tx) return error(res, 'NOT_FOUND', 'Transaction not found on network', 404);

    // Chain + sender + recipient must all line up with what was agreed.
    if (Number(tx.chainId) !== ACCEPTED_CHAIN_ID) {
      return error(res, 'VALIDATION', 'Transaction must be on Sepolia.', 400);
    }
    if (!tx.from || tx.from.toLowerCase() !== claimer.walletAddress.toLowerCase()) {
      return error(res, 'VALIDATION', 'Transaction was not sent from your bound wallet address.', 400);
    }
    if (tx.to?.toLowerCase() !== treasury.toLowerCase()) {
      return error(res, 'VALIDATION', 'Transaction was not sent to the Treasury Address', 400);
    }

    // Require the transaction to actually be confirmed and successful on-chain
    // — a dropped, un-mined, or reverted transaction must not mint credits.
    const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
    if (!receipt) {
      return error(res, 'VALIDATION', 'Transaction is not confirmed on the network yet.', 400);
    }
    if (receipt.status !== 1) {
      return error(res, 'VALIDATION', 'Transaction failed on-chain; no credits issued.', 400);
    }

    const expectedWei = ethers.parseEther(expectedEth.toString());
    if (tx.value < expectedWei) {
      return error(res, 'VALIDATION', `Transaction value (${ethers.formatEther(tx.value)} ETH) is lower than required (${expectedEth} ETH) for ${amount} Credits.`, 400);
    }

    // Dedupe: txHash is unique per claim — the (type, referenceId) unique
    // index turns a concurrent double-claim into a P2002 instead of a race.
    try {
      await prisma.$transaction(async (ptx) => {
        const existingTx = await ptx.transaction.findFirst({
          where: { referenceId: txHash, type: 'crypto_purchase' }
        });
        if (existingTx) {
          throw new Error('DUPLICATE_CLAIM');
        }

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
    } catch (err) {
      if (err.message === 'DUPLICATE_CLAIM' || err.code === 'P2002') {
        return error(res, 'DUPLICATE', 'Transaction hash already claimed', 400);
      }
      throw err;
    }

    return success(res, { message: `${amount} Credits purchased successfully!` });
  } catch (err) {
    next(err);
  }
});

// Transfer credits
router.post('/transfer', [
  body('receiverId').isMongoId().withMessage('Invalid receiver ID.'),
  body('amount').isInt({ min: 1, max: 100000 }).withMessage('Transfer amount must be between 1 and 100,000.')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'VALIDATION', 'Invalid transfer data.', 400, errors.array());
    }

    const { receiverId, amount } = req.body;
    const senderId = req.user.id;

    if (senderId === receiverId) return error(res, 'VALIDATION', 'Cannot transfer to yourself', 400);

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver) return error(res, 'NOT_FOUND', 'Receiver not found', 404);

    await prisma.$transaction(async (tx) => {
      // 1. Deduct sender — conditionally, so a concurrent spend can't push
      //    the balance negative (decrement + pre-check alone is TOCTOU).
      if (sender.globalRing !== 0) {
        const debited = await tx.user.updateMany({
          where: { id: senderId, creditBalance: { gte: amount } },
          data: { creditBalance: { decrement: amount } }
        });
        if (debited.count === 0) {
          throw new Error('INSUFFICIENT_CREDITS');
        }
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
    if (err.message === 'INSUFFICIENT_CREDITS') {
      return error(res, 'VALIDATION', 'Insufficient credits', 400);
    }
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
