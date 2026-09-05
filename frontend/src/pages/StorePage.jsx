import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ethers } from 'ethers';
import {
  Store, Coins, Trash2, Edit2, Search, PlusCircle, ShieldAlert,
  Loader2, CheckCircle2, Sparkles, X, Wallet, ArrowRight, ExternalLink
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { storeApi } from '../api/storeApi';
import resolveAsset from '../utils/resolveAsset';

export default function StorePage() {
  const { user, refreshProfile } = useAuth();
  const [listings, setListings] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [allBadges, setAllBadges] = useState([]);
  const [ledger, setLedger] = useState({ balance: 0, transactions: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('store');
  const [pricingConfig, setPricingConfig] = useState(null);
  const [popup, setPopup] = useState({ show: false, message: '', isError: false });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null });
  const [editModal, setEditModal] = useState({ show: false, listingId: '', badgeName: '', price: 0, quantity: -1 });
  const [purchasingId, setPurchasingId] = useState(null);
  const [listingSearch, setListingSearch] = useState('');
  const [badgeSearch, setBadgeSearch] = useState('');

  const showPopup = (message, isError = false) => {
    setPopup({ show: true, message, isError });
  };

  // Admin form specific
  const [badgeForm, setBadgeForm] = useState({ name: '', description: '', imageUrl: '', isEventBadge: false });
  const [adminApi, setAdminApi] = useState(null);

  useEffect(() => {
    import('../api/adminApi').then(m => setAdminApi(m.adminApi));
  }, []);

  const [badgeImage, setBadgeImage] = useState(null);
  const [listingForm, setListingForm] = useState({ badgeId: '', price: 0, quantity: -1 });
  const [mintForm, setMintForm] = useState({ userId: '', amount: 100 });
  const [creditsLoading, setCreditsLoading] = useState(false);

  const handleBuyCredits = async (amount, priceEth) => {
    try {
      if (!window.ethereum) {
        showPopup('MetaMask / Web3 provider not detected.', true);
        return;
      }
      setCreditsLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xaa36a7' }],
          });
        } catch {
          showPopup('Please switch your wallet network to Sepolia Testnet.', true);
          return;
        }
      }

      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      if (!user?.walletAddress || user.walletAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        showPopup('Sign the challenge in your wallet to verify ownership...');
        const challengeRes = await storeApi.getWalletChallenge();
        const nonce = challengeRes.data?.data?.nonce;
        const message = `Comflex wallet binding\n\nNonce: ${nonce}\nAccount: ${user?.id}`;
        const signature = await signer.signMessage(message);
        await storeApi.bindWallet({ address: signerAddress, signature });
      }

      const treasury = import.meta.env.VITE_TREASURY_ADDRESS;
      if (!treasury) throw new Error("Treasury contract address is not configured.");

      const tx = await signer.sendTransaction({
        to: treasury,
        value: ethers.parseEther(priceEth.toString()),
      });

      showPopup(`Transaction dispatched! Waiting for block confirmation...`);
      await tx.wait();

      await storeApi.buyCredits({ txHash: tx.hash, amount });
      showPopup(`Successfully minted ${amount} credits!`);
      refreshProfile();
      fetchData();
    } catch (err) {
      console.error(err);
      showPopup(err.response?.data?.error?.message || err.message || 'Credit purchase failed', true);
    } finally {
      setCreditsLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'store' || activeTab === 'admin') {
        const res = await storeApi.getListings();
        setListings(res.data?.data || []);
      }
      if (activeTab === 'admin') {
        const bRes = await storeApi.getAllBadges();
        setAllBadges(bRes.data?.data || []);
      }
      if (activeTab === 'inventory') {
        const res = await storeApi.getInventory();
        setInventory(res.data?.data || []);
      } else if (activeTab === 'ledger') {
        const res = await storeApi.getLedger();
        setLedger(res.data?.data || { balance: 0, transactions: [] });
      }

      if (activeTab === 'store' || activeTab === 'admin') {
        const cRes = await storeApi.getStoreConfig();
        setPricingConfig(cRes.data?.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePurchase = async (listingId) => {
    if (purchasingId) return;
    setPurchasingId(listingId);
    try {
      await storeApi.purchaseBadge(listingId);
      showPopup('Badge unlocked successfully!');
      fetchData();
      refreshProfile();
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Purchase failed', true);
    } finally {
      setPurchasingId(null);
    }
  };

  const handleDelist = (listingId, badgeName) => {
    setConfirmModal({
      show: true,
      title: 'Delist from Store',
      message: `Are you sure you want to delist "${badgeName}"? Students will no longer be able to purchase it.`,
      confirmText: 'Delist Item',
      onConfirm: async () => {
        setConfirmModal({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null });
        try {
          await storeApi.adminDeleteListing(listingId);
          showPopup(`"${badgeName}" was delisted from the store.`);
          fetchData();
        } catch (err) {
          showPopup(err.response?.data?.error?.message || 'Failed to delist item.', true);
        }
      },
    });
  };

  const handleOpenEdit = (listing) => {
    setEditModal({
      show: true,
      listingId: listing.id,
      badgeName: listing.badge?.name || 'Listing',
      price: listing.price,
      quantity: listing.quantity,
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await storeApi.adminUpdateListing(editModal.listingId, {
        price: parseInt(editModal.price, 10),
        quantity: parseInt(editModal.quantity, 10),
      });
      setEditModal({ show: false, listingId: '', badgeName: '', price: 0, quantity: -1 });
      showPopup(`Listing "${editModal.badgeName}" updated.`);
      fetchData();
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Failed to update listing.', true);
    }
  };

  const handleDeleteBadge = (badgeId, badgeName) => {
    setConfirmModal({
      show: true,
      title: 'Delete Badge',
      message: `Permanently delete "${badgeName}"? This action is irreversible.`,
      confirmText: 'Delete Badge',
      onConfirm: async () => {
        setConfirmModal({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null });
        try {
          await storeApi.adminDeleteBadge(badgeId);
          showPopup(`Badge "${badgeName}" deleted.`);
          fetchData();
        } catch (err) {
          showPopup(err.response?.data?.error?.message || 'Failed to delete badge.', true);
        }
      },
    });
  };

  const handleCreateBadge = async (e) => {
    e.preventDefault();
    try {
      const formData = new FormData();
      formData.append('name', badgeForm.name);
      formData.append('description', badgeForm.description);
      formData.append('isEventBadge', badgeForm.isEventBadge);
      if (badgeForm.imageUrl) formData.append('imageUrl', badgeForm.imageUrl);
      if (badgeImage) formData.append('image', badgeImage);

      await storeApi.adminCreateBadge(formData);
      setBadgeForm({ name: '', description: '', imageUrl: '', isEventBadge: false });
      setBadgeImage(null);
      showPopup('Badge created successfully!');
      fetchData();
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Creation failed', true);
    }
  };

  const handleCreateListing = async (e) => {
    e.preventDefault();
    try {
      await storeApi.adminCreateListing({
        badgeId: listingForm.badgeId,
        price: parseInt(listingForm.price, 10),
        quantity: parseInt(listingForm.quantity, 10),
      });
      showPopup('Listing published to the store!');
      setListingForm({ badgeId: '', price: 0, quantity: -1 });
      fetchData();
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Creation failed', true);
    }
  };

  const handleMintCredits = async (e) => {
    e.preventDefault();
    try {
      await storeApi.mintCredits(mintForm.userId, parseInt(mintForm.amount, 10));
      setMintForm({ userId: '', amount: 100 });
      fetchData();
      showPopup('Credits minted successfully!');
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Mint failed', true);
    }
  };

  const isAdmin = user?.globalRing === 0 || user?.canManageStore;

  const handleUpdateConfig = async (e) => {
    e.preventDefault();
    if (!adminApi) return;
    try {
      await adminApi.updateInstitution({ creditConfig: pricingConfig });
      showPopup('Pricing configuration updated!');
    } catch (err) {
      showPopup(err.response?.data?.error?.message || 'Update failed', true);
    }
  };

  const filteredListings = listings.filter((l) =>
    (l.badge?.name || '').toLowerCase().includes(listingSearch.toLowerCase()) ||
    (l.badge?.description || '').toLowerCase().includes(listingSearch.toLowerCase())
  );

  const filteredBadges = allBadges.filter((b) =>
    (b.name || '').toLowerCase().includes(badgeSearch.toLowerCase()) ||
    (b.description || '').toLowerCase().includes(badgeSearch.toLowerCase())
  );

  const tabs = [
    { key: 'store', label: 'Badge Catalog' },
    { key: 'inventory', label: 'My Inventory' },
    { key: 'ledger', label: 'Credits Ledger' },
    ...(isAdmin ? [{ key: 'admin', label: '⚙️ Store Control' }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Notifications modal */}
      <AnimatePresence>
        {popup.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`glass-card p-6 rounded-3xl max-w-sm w-full text-center border shadow-2xl relative ${
                popup.isError ? 'border-[var(--color-danger)]/40' : 'border-[var(--color-success)]/40'
              }`}
            >
              <button onClick={() => setPopup({ show: false, message: '', isError: false })} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                <X size={16} />
              </button>
              <div className="text-4xl mb-3">{popup.isError ? '⚠️' : '🎉'}</div>
              <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-2">
                {popup.isError ? 'Action Required' : 'Success'}
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-6 leading-relaxed font-medium">
                {popup.message}
              </p>
              <button
                onClick={() => setPopup({ show: false, message: '', isError: false })}
                className="btn btn-primary w-full py-2.5 text-xs shadow-md"
              >
                Continue
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 rounded-3xl max-w-md w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center gap-2.5 mb-3 text-[var(--color-danger)]">
                <ShieldAlert size={24} />
                <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">{confirmModal.title}</h3>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mb-6 leading-relaxed">{confirmModal.message}</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmModal({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null })}
                  className="btn btn-secondary text-xs px-3.5 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="btn btn-primary bg-[var(--color-danger)] text-white hover:bg-red-600 text-xs px-4 py-2 font-bold"
                >
                  {confirmModal.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Listing Modal */}
      <AnimatePresence>
        {editModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 rounded-3xl max-w-sm w-full border border-[var(--color-border)] shadow-2xl"
            >
              <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-1">Edit Listing</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">{editModal.badgeName}</p>
              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                    Price (Credits)
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editModal.price}
                    onChange={(e) => setEditModal({ ...editModal, price: e.target.value })}
                    className="matte-input text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1">
                    Stock (-1 for infinite)
                  </label>
                  <input
                    type="number"
                    min="-1"
                    required
                    value={editModal.quantity}
                    onChange={(e) => setEditModal({ ...editModal, quantity: e.target.value })}
                    className="matte-input text-xs"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setEditModal({ show: false, listingId: '', badgeName: '', price: 0, quantity: -1 })}
                    className="btn btn-secondary text-xs px-3"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary text-xs px-4">
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)] flex items-center gap-2.5">
            <Store size={24} className="text-[var(--color-accent)]" />
            <span>Badge Store & Web3 Ledger</span>
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Collect digital reputation badges and manage credit balances</p>
        </div>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)]">
          <Coins size={15} className="text-[var(--color-warning)]" />
          <span className="text-xs font-bold text-[var(--color-text-primary)]">
            {user?.globalRing === 0 ? '∞ Unlimited' : `${user?.creditBalance ?? 0} Credits`}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1.5 bg-[var(--color-bg-matte)] rounded-2xl border border-[var(--color-border)] mb-6 overflow-x-auto scrollbar-none">
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`relative flex-1 shrink-0 whitespace-nowrap py-2 px-3.5 rounded-xl text-xs font-bold transition-all ${
                active ? 'text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="store-tab-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[var(--color-accent)] to-[#528976] shadow-md"
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 flex justify-center items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
          <span>Synchronizing store inventory...</span>
        </div>
      ) : (
        <>
          {activeTab === 'store' && (
            <>
              {/* Web3 Credit Exchange Banner */}
              <div className="glass-card p-6 mb-8 border border-[var(--color-warning)]/40 bg-[var(--palette-bisque)]/20 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Wallet size={18} className="text-[var(--color-warning)]" />
                      <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Need More Credits?</h3>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-md">
                      Exchange Sepolia Testnet ETH for instant platform credits securely on-chain.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    {[
                      { amount: 100, price: pricingConfig?.creditEthPrice?.['100'] || 0.01 },
                      { amount: 500, price: pricingConfig?.creditEthPrice?.['500'] || 0.045 },
                      { amount: 2000, price: pricingConfig?.creditEthPrice?.['2000'] || 0.15 },
                    ].map((tier) => (
                      <button
                        key={tier.amount}
                        disabled={creditsLoading}
                        onClick={() => handleBuyCredits(tier.amount, tier.price)}
                        className="btn btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 border-[var(--color-warning)]/30 hover:border-[var(--color-warning)]"
                      >
                        <Coins size={12} className="text-[var(--color-warning)]" />
                        <span>{tier.amount} 🪙 ({tier.price} ETH)</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Badge Listings Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {listings.length === 0 && (
                  <p className="text-xs text-[var(--color-text-muted)] col-span-3 text-center py-10">No items available in store right now.</p>
                )}
                {listings.map((l) => (
                  <div
                    key={l.id}
                    className="glass-card p-5 flex flex-col items-center hover-lift border border-[var(--color-border)] relative group"
                  >
                    {isAdmin && (
                      <div className="w-full flex justify-between items-center mb-3 pb-2 border-b border-[var(--color-border)]/60 text-xs">
                        <span className="font-bold text-[10px] uppercase text-[var(--color-accent)]">Admin Control</span>
                        <div className="flex gap-2">
                          <button onClick={() => handleOpenEdit(l)} className="hover:text-[var(--color-accent)] flex items-center gap-1 text-[11px]">
                            <Edit2 size={12} /> Edit
                          </button>
                          <button onClick={() => handleDelist(l.id, l.badge?.name)} className="text-[var(--color-danger)] flex items-center gap-1 text-[11px]">
                            <Trash2 size={12} /> Delist
                          </button>
                        </div>
                      </div>
                    )}

                    <img
                      src={resolveAsset(l.badge?.imageUrl)}
                      alt={l.badge?.name}
                      className="w-20 h-20 mb-3 object-cover drop-shadow-md rounded-2xl"
                      onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="%2368a691" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                    />
                    <h3 className="font-bold text-sm text-[var(--color-text-primary)] mb-1 text-center">{l.badge?.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)] text-center mb-4 line-clamp-2">{l.badge?.description}</p>

                    <div className="mt-auto flex w-full items-center justify-between text-xs pt-3 border-t border-[var(--color-border)]/60">
                      <span className="font-bold text-[var(--palette-teal)] flex items-center gap-1">
                        <Coins size={13} className="text-[var(--color-warning)]" /> {l.price}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {l.quantity === -1 ? '∞ In Stock' : `${Math.max(0, l.quantity - l.sold)} remaining`}
                      </span>
                    </div>

                    <button
                      onClick={() => handlePurchase(l.id)}
                      disabled={(user?.globalRing !== 0 && user?.creditBalance < l.price) || (l.quantity !== -1 && l.sold >= l.quantity) || purchasingId === l.id}
                      className="btn btn-primary w-full mt-3 py-2 text-xs shadow-xs"
                    >
                      {purchasingId === l.id ? 'Unlocking...' : l.quantity !== -1 && l.sold >= l.quantity ? 'Sold Out' : 'Purchase Badge'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'inventory' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {inventory.length === 0 && (
                  <div className="glass-card p-10 text-center col-span-4 border border-[var(--color-border)]">
                    <p className="text-xs text-[var(--color-text-muted)]">You don&apos;t hold any badges yet. Browse the Store Catalog to acquire badges.</p>
                  </div>
                )}
                {inventory.map((inv) => (
                  <div key={inv.id} className="glass-card p-4 flex flex-col items-center border border-[var(--color-border)] hover-lift">
                    <img
                      src={resolveAsset(inv.badge?.imageUrl)}
                      alt={inv.badge?.name}
                      className="w-16 h-16 mb-2 object-cover drop-shadow-sm rounded-xl"
                      onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%2368a691" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                    />
                    <h4 className="font-bold text-xs text-center text-[var(--color-text-primary)]">{inv.badge?.name}</h4>
                    <span className="text-[10px] text-[var(--color-text-muted)] mt-1 px-2 py-0.2 rounded-full bg-[var(--color-bg-secondary)]">
                      {inv.source}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30 flex items-center justify-between gap-4">
                <div className="text-xs">
                  <p className="font-bold text-[var(--color-text-primary)]">Showcase Badges on Profile</p>
                  <p className="text-[var(--color-text-secondary)] mt-0.5">Equip up to 5 badges to display on your avatar in messages and channels.</p>
                </div>
                <Link to="/profile" className="btn btn-primary text-xs py-1.5 px-3 shadow-xs shrink-0">
                  Open Profile
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="glass-card p-0 overflow-hidden border border-[var(--color-border)]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Timestamp</th>
                      <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Type</th>
                      <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Credits</th>
                      <th className="p-3.5 font-bold border-b border-[var(--color-border)]">Counterparty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]/50">
                    {ledger.transactions.length === 0 && (
                      <tr>
                        <td colSpan="4" className="p-6 text-center text-xs text-[var(--color-text-muted)]">
                          No transactions recorded.
                        </td>
                      </tr>
                    )}
                    {ledger.transactions.map((tx) => {
                      const isCredit = tx.type === 'crypto_purchase' || tx.type === 'download_reward' || tx.type === 'event_reward' || (tx.type === 'transfer' && tx.receiverId === user?.id);
                      return (
                        <tr key={tx.id} className="hover:bg-[var(--color-bg-secondary)]/50 transition">
                          <td className="p-3.5 text-[var(--color-text-muted)]">{new Date(tx.createdAt).toLocaleString()}</td>
                          <td className="p-3.5 font-semibold capitalize">{tx.type.replace('_', ' ')}</td>
                          <td className="p-3.5 font-bold">
                            <span className={isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                              {isCredit ? '+' : '-'}{tx.amount} 🪙
                            </span>
                          </td>
                          <td className="p-3.5 text-[var(--color-text-secondary)]">
                            {tx.type === 'purchase' ? 'Store Purchase'
                              : tx.type === 'crypto_purchase' ? 'Sepolia ETH On-Chain'
                              : tx.type === 'download_reward' ? 'Peer Download Reward'
                              : tx.type === 'event_reward' ? 'Campus Event Prize'
                              : isCredit ? `From ${tx.sender?.displayName || 'System'}`
                              : `To ${tx.receiver?.displayName || 'Recipient'}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'admin' && isAdmin && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Create Badge Form */}
                <div className="glass-card p-6 border border-[var(--color-border)]">
                  <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-1">Create New Badge</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mb-4">Register a badge asset into the system database.</p>
                  <form onSubmit={handleCreateBadge} className="space-y-3">
                    <input
                      type="text"
                      placeholder="Badge Name"
                      required
                      className="matte-input text-xs"
                      value={badgeForm.name}
                      onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setBadgeImage(e.target.files[0])}
                      className="matte-input text-xs"
                    />
                    <textarea
                      placeholder="Badge Description"
                      required
                      rows={2}
                      className="matte-input text-xs resize-none"
                      value={badgeForm.description}
                      onChange={(e) => setBadgeForm({ ...badgeForm, description: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] font-medium">
                      <input
                        type="checkbox"
                        checked={badgeForm.isEventBadge}
                        onChange={(e) => setBadgeForm({ ...badgeForm, isEventBadge: e.target.checked })}
                      />
                      Event exclusive badge (Cannot be purchased in store)
                    </label>
                    <button type="submit" className="btn btn-primary w-full text-xs py-2 mt-1">
                      Register Badge
                    </button>
                  </form>
                </div>

                {/* Create Store Listing Form */}
                <div className="glass-card p-6 border border-[var(--color-border)]">
                  <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-1">Publish Store Listing</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mb-4">List an existing badge on the public store.</p>
                  <form onSubmit={handleCreateListing} className="space-y-3">
                    <input
                      type="text"
                      placeholder="Badge ID (e.g. 64b8f...)"
                      required
                      className="matte-input text-xs font-mono"
                      value={listingForm.badgeId}
                      onChange={(e) => setListingForm({ ...listingForm, badgeId: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="Price (Credits)"
                      min="0"
                      required
                      className="matte-input text-xs"
                      value={listingForm.price}
                      onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="Stock quantity (-1 for unlimited)"
                      required
                      className="matte-input text-xs"
                      value={listingForm.quantity}
                      onChange={(e) => setListingForm({ ...listingForm, quantity: e.target.value })}
                    />
                    <button type="submit" className="btn btn-primary w-full text-xs py-2 mt-1">
                      Publish to Store
                    </button>
                  </form>
                </div>
              </div>

              {/* Mint Credits */}
              {user?.globalRing === 0 && (
                <div className="glass-card p-6 border border-[var(--color-border)]">
                  <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-1">Mint Credits</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mb-4">Directly grant credits to a student account.</p>
                  <form onSubmit={handleMintCredits} className="flex flex-col sm:flex-row gap-3 max-w-lg">
                    <input
                      type="text"
                      placeholder="User ID or Email"
                      required
                      className="matte-input text-xs flex-1"
                      value={mintForm.userId}
                      onChange={(e) => setMintForm({ ...mintForm, userId: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="Amount"
                      min="1"
                      required
                      className="matte-input text-xs w-32"
                      value={mintForm.amount}
                      onChange={(e) => setMintForm({ ...mintForm, amount: e.target.value })}
                    />
                    <button type="submit" className="btn btn-primary text-xs px-4">
                      Mint
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
