import api from './client';

export const storeApi = {
  // Store Config (Dynamic Pricing)
  getStoreConfig: () => api.get('/store/config'),

  // Store
  getAllBadges: () => api.get('/store/badges'),
  getListings: () => api.get('/store/listings'),
  purchaseBadge: (listingId) => api.post('/store/purchase', { listingId }),

  // Inventory & Profile
  getInventory: () => api.get('/store/inventory'),
  setDisplayBadges: (badgeIds) => api.post('/store/display-badges', { badgeIds }),

  // Ledger / Credits
  getLedger: () => api.get('/store/ledger'),
  transferCredits: (receiverId, amount) => api.post('/store/transfer', { receiverId, amount }),

  // Admin Store
  adminCreateBadge: (data) => api.post('/store/admin/badges', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  adminCreateListing: (data) => api.post('/store/admin/listings', data),
  mintCredits: (userId, amount) => api.post('/store/admin/mint-credits', { userId, amount }),

  // Crypto
  buyCredits: (data) => api.post('/store/buy-credits', data)
};
