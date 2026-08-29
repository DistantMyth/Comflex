import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { storeApi } from '../api/storeApi';
import { ethers } from 'ethers';
import { Store, Coins, Trash2, Edit2, Search, PlusCircle, ShieldAlert } from 'lucide-react';
import resolveAsset from '../utils/resolveAsset';

export default function StorePage() {
  const { user, refreshProfile } = useAuth();
  const [listings, setListings] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [allBadges, setAllBadges] = useState([]);
  const [ledger, setLedger] = useState({ balance: 0, transactions: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('store'); // store, inventory, ledger, (admin)
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
        showPopup('MetaMask is not installed!', true);
        return;
      }
      setCreditsLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      // Verify Sepolia testnet chain
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

      // Verify wallet binding — sign challenge if not bound
      if (!user?.walletAddress || user.walletAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        showPopup('Please sign the message in your wallet to bind your address before purchase...');
        const challengeRes = await storeApi.getWalletChallenge();
        const nonce = challengeRes.data.data.nonce;
        const message = `Comflex wallet binding\n\nNonce: ${nonce}\nAccount: ${user?.id}`;
        const signature = await signer.signMessage(message);
        await storeApi.bindWallet({ address: signerAddress, signature });
      }

      const treasury = import.meta.env.VITE_TREASURY_ADDRESS;
      if (!treasury) throw new Error("Treasury not configured");

      const tx = await signer.sendTransaction({
        to: treasury,
        value: ethers.parseEther(priceEth.toString())
      });

      showPopup(`Transaction sent! Waiting for confirmation... Hash: ${tx.hash}`);
      await tx.wait();

      await storeApi.buyCredits({ txHash: tx.hash, amount });
      showPopup(`Successfully purchased ${amount} credits!`);
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
        setListings(res.data.data || []);
      }
      if (activeTab === 'admin') {
        const bRes = await storeApi.getAllBadges();
        setAllBadges(bRes.data.data || []);
      }
      if (activeTab === 'inventory') {
        const res = await storeApi.getInventory();
        setInventory(res.data.data || []);
      } else if (activeTab === 'ledger') {
        const res = await storeApi.getLedger();
        setLedger(res.data.data || { balance: 0, transactions: [] });
      }

      if (activeTab === 'store' || activeTab === 'admin') {
        const cRes = await storeApi.getStoreConfig();
        setPricingConfig(cRes.data.data);
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
      showPopup('Purchase successful!');
      fetchData();
      refreshProfile(); // to update credits
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
      message: `Are you sure you want to delist "${badgeName}" from the store? Users will no longer be able to purchase it.`,
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
      }
    });
  };

  const handleOpenEdit = (listing) => {
    setEditModal({
      show: true,
      listingId: listing.id,
      badgeName: listing.badge?.name || 'Listing',
      price: listing.price,
      quantity: listing.quantity
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await storeApi.adminUpdateListing(editModal.listingId, {
        price: parseInt(editModal.price, 10),
        quantity: parseInt(editModal.quantity, 10)
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
      message: `Are you sure you want to permanently delete badge "${badgeName}"? This action cannot be undone.`,
      confirmText: 'Delete Badge',
      onConfirm: async () => {
        setConfirmModal({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null });
        try {
          await storeApi.adminDeleteBadge(badgeId);
          showPopup(`Badge "${badgeName}" deleted successfully.`);
          fetchData();
        } catch (err) {
          showPopup(err.response?.data?.error?.message || 'Failed to delete badge.', true);
        }
      }
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
        quantity: parseInt(listingForm.quantity, 10)
      });
      showPopup('Listing created and published to the store!');
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
      showPopup('Credits successfully minted!');
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
      showPopup('Pricing configuration updated successfully!');
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

  return (
    <>
      {/* Custom Popup Modal */}
      {popup.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" style={{ animationDuration: '0.2s' }}>
          <div className={`glass-card p-8 rounded-2xl max-w-sm w-full text-center border-2 shadow-2xl relative transition-transform transform scale-100 ${popup.isError ? 'border-[var(--color-danger)] shadow-[var(--color-danger)]/20' : 'border-[var(--color-success)] shadow-[var(--color-success)]/20'}`}>
            <button onClick={() => setPopup({ show: false, message: '', isError: false })} className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-white transition">✖</button>
            <div className="text-5xl mb-6">{popup.isError ? '❌' : '🎉'}</div>
            <h3 className="text-xl font-extrabold mb-3">{popup.isError ? 'Notice' : 'Success!'}</h3>
            <p className="text-[var(--color-text-secondary)] mb-8 leading-relaxed font-medium">{popup.message}</p>
            <button
              onClick={() => setPopup({ show: false, message: '', isError: false })}
              className={`btn w-full text-white font-bold py-3 rounded-xl shadow-lg transition-transform hover:-translate-y-1 ${popup.isError ? 'bg-[var(--color-danger)] hover:bg-red-600 shadow-red-500/30' : 'bg-[var(--color-success)] hover:bg-green-600 shadow-green-500/30'}`}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card p-6 rounded-2xl max-w-md w-full border border-white/10 shadow-2xl">
            <div className="flex items-center gap-3 mb-3 text-[var(--color-danger)]">
              <ShieldAlert size={28} />
              <h3 className="text-lg font-bold text-[var(--color-text-primary)]">{confirmModal.title}</h3>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModal({ show: false, title: '', message: '', confirmText: 'Confirm', onConfirm: null })}
                className="btn btn-secondary text-sm px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="btn bg-[var(--color-danger)] text-white hover:bg-red-600 text-sm px-4 py-2 font-bold"
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Listing Modal */}
      {editModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card p-6 rounded-2xl max-w-sm w-full border border-white/10 shadow-2xl">
            <h3 className="text-lg font-bold mb-1">Edit Listing</h3>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">{editModal.badgeName}</p>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-[var(--color-text-secondary)]">Price (Credits)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={editModal.price}
                  onChange={(e) => setEditModal({ ...editModal, price: e.target.value })}
                  className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-[var(--color-text-secondary)]">Quantity / Stock (-1 for infinite)</label>
                <input
                  type="number"
                  min="-1"
                  required
                  value={editModal.quantity}
                  onChange={(e) => setEditModal({ ...editModal, quantity: e.target.value })}
                  className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2 rounded-xl text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditModal({ show: false, listingId: '', badgeName: '', price: 0, quantity: -1 })}
                  className="btn btn-secondary text-xs px-3 py-2"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-xs px-4 py-2 font-bold">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto pb-12">
        <div className="flex items-center justify-center sm:justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-3xl font-bold font-display flex items-center gap-2">
            <Store size={26} className="text-[var(--color-accent)]" /> Web3 Store & Ledger
          </h1>
          <div className="flex items-center gap-4">
            <span className="font-semibold text-[var(--color-primary)]">
              <Coins size={16} className="inline text-[var(--color-warning)]" /> Credits: {user?.globalRing === 0 ? '∞' : (user?.creditBalance ?? 0)}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-3 mb-6 sticky top-0 bg-[var(--color-bg-primary)] z-10 py-2 overflow-x-auto">
          <button onClick={() => setActiveTab('store')} className={`btn whitespace-nowrap ${activeTab === 'store' ? 'btn-primary' : 'btn-secondary'}`}>Badges Store</button>
          <button onClick={() => setActiveTab('inventory')} className={`btn whitespace-nowrap ${activeTab === 'inventory' ? 'btn-primary' : 'btn-secondary'}`}>My Inventory</button>
          <button onClick={() => setActiveTab('ledger')} className={`btn whitespace-nowrap ${activeTab === 'ledger' ? 'btn-primary' : 'btn-secondary'}`}>Ledger History</button>
          {isAdmin && (
            <button onClick={() => setActiveTab('admin')} className={`btn whitespace-nowrap ${activeTab === 'admin' ? 'bg-[var(--color-danger)] text-white' : 'btn-secondary'}`}>⚙️ Store Management</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton h-64 w-full rounded-xl" />
        ) : (
          <>
            {activeTab === 'store' && (
              <>
                {/* Buy Credits Banner */}
                <div className="glass-card p-6 border-2 border-yellow-400 bg-yellow-50/10 w-full max-w-4xl mx-auto text-center mb-6">
                  <h3 className="text-xl font-bold mb-2 text-yellow-600">Need more Credits?</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mb-4">Exchange ETH for credits instantly entirely on-chain.</p>
                  <div className="flex justify-center gap-4 flex-wrap">
                    <button disabled={creditsLoading} onClick={() => handleBuyCredits(100, pricingConfig?.creditEthPrice?.['100'] || 0.01)} className="btn bg-yellow-100 text-yellow-800 hover:bg-yellow-200">100 Credits 🪙 ({pricingConfig?.creditEthPrice?.['100'] || 0.01} ETH) </button>
                    <button disabled={creditsLoading} onClick={() => handleBuyCredits(500, pricingConfig?.creditEthPrice?.['500'] || 0.045)} className="btn bg-yellow-400 text-white hover:bg-yellow-500">500 Credits 🪙 ({pricingConfig?.creditEthPrice?.['500'] || 0.045} ETH) </button>
                    <button disabled={creditsLoading} onClick={() => handleBuyCredits(2000, pricingConfig?.creditEthPrice?.['2000'] || 0.15)} className="btn bg-yellow-600 text-white hover:bg-yellow-700">2000 Credits 🪙 ({pricingConfig?.creditEthPrice?.['2000'] || 0.15} ETH) </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {listings.length === 0 ? <p className="text-[var(--color-text-muted)] col-span-3 text-center py-10">No active listings currently available.</p> : null}
                  {listings.map(l => (
                    <div key={l.id} className="glass-card p-5 flex flex-col items-center hover:scale-[1.02] transition-transform duration-300 relative group">
                      {/* Admin Quick Action Controls */}
                      {isAdmin && (
                        <div className="w-full flex justify-between items-center mb-2 pb-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                          <span className="font-semibold text-[10px] uppercase text-[var(--color-accent)]">Admin Actions</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleOpenEdit(l)}
                              className="hover:text-[var(--color-accent)] flex items-center gap-1"
                              title="Edit price or stock"
                            >
                              <Edit2 size={13} /> Edit
                            </button>
                            <button
                              onClick={() => handleDelist(l.id, l.badge.name)}
                              className="text-[var(--color-danger)] hover:opacity-80 flex items-center gap-1 font-semibold"
                              title="Delist from store"
                            >
                              <Trash2 size={13} /> Delist
                            </button>
                          </div>
                        </div>
                      )}

                      <img
                        src={resolveAsset(l.badge.imageUrl)}
                        alt={l.badge.name}
                        className="w-24 h-24 mb-4 object-cover drop-shadow-lg rounded-xl"
                        onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="%237c3aed" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                      />
                      <h3 className="font-bold text-lg mb-1">{l.badge.name}</h3>
                      <p className="text-xs text-[var(--color-text-muted)] text-center mb-4">{l.badge.description}</p>
                      <div className="mt-auto flex w-full items-center justify-between">
                        <span className="font-bold text-[var(--color-primary)]">🪙 {l.price}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{l.quantity === -1 ? '∞ Unlimited' : `${Math.max(0, l.quantity - l.sold)} left`}</span>
                      </div>
                      <button
                        onClick={() => handlePurchase(l.id)}
                        disabled={(user?.globalRing !== 0 && user?.creditBalance < l.price) || (l.quantity !== -1 && l.sold >= l.quantity) || purchasingId === l.id}
                        className="btn btn-primary w-full mt-4"
                      >
                        {purchasingId === l.id ? 'Purchasing...' : l.quantity !== -1 && l.sold >= l.quantity ? 'Sold Out' : 'Buy Now'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'inventory' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {inventory.length === 0 ? <p className="text-[var(--color-text-muted)] col-span-3">You don't own any badges yet.</p> : null}
                {inventory.map(inv => (
                  <div key={inv.id} className="glass-card p-4 flex flex-col items-center">
                    <img
                      src={resolveAsset(inv.badge.imageUrl)}
                      alt={inv.badge.name}
                      className="w-16 h-16 mb-2 object-cover drop-shadow-md rounded-lg"
                      onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%237c3aed" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                    />
                    <h4 className="font-bold text-sm text-center">{inv.badge.name}</h4>
                    <span className="text-[10px] text-[var(--color-text-muted)] mt-2 italic bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded">Source: {inv.source}</span>
                  </div>
                ))}
                <div className="col-span-full mt-4 p-4 border border-[var(--color-accent)] rounded-lg bg-[var(--color-accent)]/10">
                  <p className="text-sm font-semibold text-[var(--color-accent)]">💡 Want to show these off?</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">Go to your <Link to="/profile" className="underline font-bold">Profile</Link> to equip up to 5 badges to display next to your name in chats!</p>
                </div>
              </div>
            )}

            {activeTab === 'ledger' && (
              <div className="glass-card p-0 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="p-4 font-semibold border-b border-[var(--color-border)]">Date</th>
                      <th className="p-4 font-semibold border-b border-[var(--color-border)]">Type</th>
                      <th className="p-4 font-semibold border-b border-[var(--color-border)]">Amount</th>
                      <th className="p-4 font-semibold border-b border-[var(--color-border)]">From / To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.transactions.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-[var(--color-text-muted)]">No transactions found.</td></tr>}
                    {ledger.transactions.map((tx) => {
                      const isCredit = tx.type === 'crypto_purchase' || tx.type === 'download_reward' || tx.type === 'event_reward' || (tx.type === 'transfer' && tx.receiverId === user?.id);
                      return (
                        <tr key={tx.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]/50">
                          <td className="p-4">{new Date(tx.createdAt).toLocaleString()}</td>
                          <td className="p-4 capitalize">{tx.type.replace('_', ' ')}</td>
                          <td className="p-4 font-bold">
                            <span className={isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                              {isCredit ? '+' : '-'}🪙 {tx.amount}
                            </span>
                          </td>
                          <td className="p-4 text-[var(--color-text-secondary)]">
                            {tx.type === 'purchase' ? 'Store'
                             : tx.type === 'crypto_purchase' ? 'Crypto Purchase (ETH)'
                             : tx.type === 'download_reward' ? 'System Reward'
                             : tx.type === 'event_reward' ? 'Event Reward'
                             : isCredit ? `From ${tx.sender?.displayName || 'System'}`
                             : `To ${tx.receiver?.displayName}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'admin' && isAdmin && (
              <div className="space-y-8">
                {/* Active Store Listings Management */}
                <div className="glass-card p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-xl font-bold">Active Store Listings</h2>
                      <p className="text-xs text-[var(--color-text-muted)]">Manage and delist items currently on sale in the store.</p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        placeholder="Search active listings..."
                        value={listingSearch}
                        onChange={(e) => setListingSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl text-xs outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                  </div>

                  {filteredListings.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)] py-6 text-center italic">No matching store listings found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                          <tr>
                            <th className="p-3 font-semibold rounded-l-lg">Badge</th>
                            <th className="p-3 font-semibold">Price</th>
                            <th className="p-3 font-semibold">Stock / Sold</th>
                            <th className="p-3 font-semibold text-right rounded-r-lg">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                          {filteredListings.map((l) => (
                            <tr key={l.id} className="hover:bg-[var(--color-bg-secondary)]/40 transition">
                              <td className="p-3 flex items-center gap-2.5">
                                <img
                                  src={resolveAsset(l.badge?.imageUrl)}
                                  alt=""
                                  className="w-8 h-8 rounded-lg object-cover"
                                  onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="%237c3aed" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                                />
                                <div>
                                  <span className="font-bold text-sm text-[var(--color-text-primary)]">{l.badge?.name}</span>
                                  <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{l.id}</p>
                                </div>
                              </td>
                              <td className="p-3 font-semibold text-[var(--color-primary)]">🪙 {l.price}</td>
                              <td className="p-3 text-[var(--color-text-secondary)]">
                                {l.quantity === -1 ? '∞ Unlimited' : `${Math.max(0, l.quantity - l.sold)} available`} • <span className="text-[var(--color-text-muted)]">{l.sold} sold</span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex gap-2 justify-end">
                                  <button
                                    onClick={() => handleOpenEdit(l)}
                                    className="btn btn-secondary text-xs px-2.5 py-1 flex items-center gap-1"
                                    title="Edit price or stock"
                                  >
                                    <Edit2 size={12} /> Edit
                                  </button>
                                  <button
                                    onClick={() => handleDelist(l.id, l.badge.name)}
                                    className="btn bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white text-xs px-2.5 py-1 flex items-center gap-1 font-semibold transition"
                                    title="Delist from store"
                                  >
                                    <Trash2 size={12} /> Delist
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Create Badge */}
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-bold mb-2">Create New Badge</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4">Add a new badge asset to the platform catalog.</p>
                    <form onSubmit={handleCreateBadge} className="space-y-4">
                      <input type="text" placeholder="Badge Name" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                        value={badgeForm.name} onChange={e => setBadgeForm({...badgeForm, name: e.target.value})} />
                      <input type="file" accept="image/*" onChange={e => setBadgeImage(e.target.files[0])} className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]" />
                      <p className="text-xs text-center text-[var(--color-text-muted)]">- OR -</p>
                      <input type="text" placeholder="Upload via Image URL instead" className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                        value={badgeForm.imageUrl} onChange={e => setBadgeForm({...badgeForm, imageUrl: e.target.value})} />
                      <textarea placeholder="Description" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                        value={badgeForm.description} onChange={e => setBadgeForm({...badgeForm, description: e.target.value})} />
                      <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        <input type="checkbox" checked={badgeForm.isEventBadge} onChange={e => setBadgeForm({...badgeForm, isEventBadge: e.target.checked})} />
                        Event Badge (Cannot be sold in store)
                      </label>
                      <button type="submit" className="btn btn-primary w-full text-xs font-semibold py-2.5">Create Badge</button>
                    </form>
                  </div>

                  {/* Create Store Listing */}
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-bold mb-2">Create Store Listing</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4">List an existing badge on the public store.</p>
                    <form onSubmit={handleCreateListing} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-[var(--color-text-secondary)]">Badge ID</label>
                        <input type="text" placeholder="e.g. 64b8f... (or click List on Store below)" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs font-mono focus:outline-[var(--color-accent)]"
                          value={listingForm.badgeId} onChange={e => setListingForm({...listingForm, badgeId: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-[var(--color-text-secondary)]">Price (Credits)</label>
                        <input type="number" placeholder="Price (Credits)" min="0" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                          value={listingForm.price} onChange={e => setListingForm({...listingForm, price: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-[var(--color-text-secondary)]">Stock / Quantity (-1 for unlimited)</label>
                        <input type="number" placeholder="Quantity (-1 for infinite)" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                          value={listingForm.quantity} onChange={e => setListingForm({...listingForm, quantity: e.target.value})} />
                      </div>
                      <button type="submit" className="btn btn-primary w-full text-xs font-semibold py-2.5">Publish to Store</button>
                    </form>
                  </div>
                </div>

                {user?.globalRing === 0 && (
                  <div className="glass-card p-6">
                    <h2 className="text-xl font-bold mb-4">Mint Credits to User</h2>
                    <form onSubmit={handleMintCredits} className="space-y-4 max-w-md mb-8">
                      <input type="text" placeholder="User ID, Username, or Email" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                        value={mintForm.userId} onChange={e => setMintForm({...mintForm, userId: e.target.value})} />
                      <input type="number" placeholder="Amount" min="1" required className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-2.5 rounded-xl text-xs focus:outline-[var(--color-accent)]"
                        value={mintForm.amount} onChange={e => setMintForm({...mintForm, amount: e.target.value})} />
                      <button type="submit" className="btn btn-primary w-full text-white bg-[var(--color-success)] text-xs font-semibold py-2.5">Mint Credits</button>
                    </form>

                    <h2 className="text-xl font-bold mb-4 border-t border-[var(--color-border)] pt-4">Dynamic Store Pricing</h2>
                    {pricingConfig && (
                      <form onSubmit={handleUpdateConfig} className="grid grid-cols-2 gap-4 text-xs">
                        <div className="col-span-2 font-bold mt-2 border-b border-[var(--color-border)] pb-1">Credit Currency Rates (ETH)</div>
                        <label className="flex flex-col">100 Credits <input type="number" step="0.001" className="p-2 mt-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs" value={pricingConfig.creditEthPrice?.['100'] ?? ''} onChange={e => setPricingConfig({...pricingConfig, creditEthPrice: {...pricingConfig.creditEthPrice, '100': parseFloat(e.target.value)}})} /></label>
                        <label className="flex flex-col">500 Credits <input type="number" step="0.001" className="p-2 mt-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs" value={pricingConfig.creditEthPrice?.['500'] ?? ''} onChange={e => setPricingConfig({...pricingConfig, creditEthPrice: {...pricingConfig.creditEthPrice, '500': parseFloat(e.target.value)}})} /></label>
                        <label className="flex flex-col">2000 Credits <input type="number" step="0.001" className="p-2 mt-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs" value={pricingConfig.creditEthPrice?.['2000'] ?? ''} onChange={e => setPricingConfig({...pricingConfig, creditEthPrice: {...pricingConfig.creditEthPrice, '2000': parseFloat(e.target.value)}})} /></label>

                        <button type="submit" className="col-span-2 btn btn-primary mt-2 flex items-center justify-center text-xs font-semibold py-2.5">💾 Save Dynamic Configuration</button>
                      </form>
                    )}
                  </div>
                )}

                {/* Badge Database Catalog */}
                <div className="glass-card p-6 border-t border-[var(--color-border)] mt-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-xl font-bold">Badge Database</h2>
                      <p className="text-xs text-[var(--color-text-muted)]">All created badges across the platform.</p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        placeholder="Search badge database..."
                        value={badgeSearch}
                        onChange={(e) => setBadgeSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl text-xs outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                  </div>

                  {filteredBadges.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)] italic py-6 text-center">No badges found in catalog.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredBadges.map(b => (
                        <div key={b.id} className="flex flex-col gap-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-3.5 rounded-xl overflow-hidden shadow-sm">
                          <div className="flex items-center gap-3">
                            <img
                              src={resolveAsset(b.imageUrl)}
                              alt={b.name}
                              className="w-12 h-12 rounded-lg object-cover"
                              onError={(e) => { e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%237c3aed" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>'; }}
                            />
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-sm truncate">{b.name}</h4>
                              <p className="text-[10px] text-[var(--color-text-muted)] truncate">{b.description}</p>
                              <p className="text-[9px] text-[var(--color-text-muted)] font-mono mt-0.5 truncate" title="Click to copy ID">{b.id}</p>
                            </div>
                          </div>
                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-[var(--color-border)]/60">
                            {b.isEventBadge ? (
                              <span className="text-[10px] bg-[var(--color-accent)]/20 text-[var(--color-accent)] px-2 py-0.5 rounded font-semibold">Event Bound</span>
                            ) : (
                              <span className="text-[10px] bg-[var(--color-success)]/20 text-[var(--color-success)] px-2 py-0.5 rounded font-semibold">Store Ready</span>
                            )}
                            <div className="flex gap-2 items-center">
                              {!b.isEventBadge && (
                                <button
                                  onClick={() => { setListingForm({...listingForm, badgeId: b.id}); window.scrollTo({top: 200, behavior: 'smooth'}); }}
                                  className="btn btn-secondary text-[11px] px-2.5 py-1 shrink-0 flex items-center gap-1 font-semibold"
                                  title="Load into Store Listing form"
                                >
                                  <PlusCircle size={12} /> List
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteBadge(b.id, b.name)}
                                className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 p-1 rounded transition"
                                title="Delete badge from database"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
