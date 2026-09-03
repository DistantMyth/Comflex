import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Camera, Pencil, Save, X, CreditCard, Calendar, BookOpen, Code2,
  Loader2, Mail, MailCheck, ShieldCheck, Send, RotateCcw, Trash2, AtSign, Check, Award
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { userApi } from '../api/userApi';
import { storeApi } from '../api/storeApi';
import { parseStudentEmail } from '../utils/parseEmail';
import Avatar from '../components/Avatar';
import resolveAsset from '../utils/resolveAsset';

const RING_LABELS = ['Admin', 'Manager', 'Elevated Member', 'Member'];

const formatCooldown = (sec) => (sec >= 60 ? `${Math.ceil(sec / 60)}m` : `${sec}s`);

export default function ProfilePage() {
  const { user, setUser, refreshProfile, setUsername } = useAuth();
  const fileInputRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ displayName: '', bio: '', cfHandle: '' });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [message, setMessage] = useState('');

  const [badgeMap, setBadgeMap] = useState({});
  const [inventory, setInventory] = useState([]);
  const [selectedBadges, setSelectedBadges] = useState([]);

  // Personal email verification
  const [peEditing, setPeEditing] = useState(false);
  const [peEmail, setPeEmail] = useState('');
  const [peBusy, setPeBusy] = useState(false);
  const [peAction, setPeAction] = useState('');
  const [peMessage, setPeMessage] = useState('');
  const [peError, setPeError] = useState('');
  const [peCooldown, setPeCooldown] = useState(0);
  const cooldownRef = useRef(null);
  const [peLimit, setPeLimit] = useState(null);

  // Username editing
  const [unEditing, setUnEditing] = useState(false);
  const [unValue, setUnValue] = useState('');
  const [unAvailable, setUnAvailable] = useState(null);
  const [unChecking, setUnChecking] = useState(false);
  const [unBusy, setUnBusy] = useState(false);
  const [unMessage, setUnMessage] = useState('');
  const [unError, setUnError] = useState('');

  const personalEmailVerified = Boolean(user?.personalEmailVerified);
  const hasPersonalEmail = Boolean(user?.personalEmail);

  useEffect(() => {
    if (!unEditing || unValue.length < 3) {
      setUnAvailable(null);
      return;
    }
    const timer = setTimeout(async () => {
      setUnChecking(true);
      try {
        const res = await userApi.checkUsername(unValue);
        setUnAvailable(res.data.data.available);
      } catch {
        setUnAvailable(null);
      } finally {
        setUnChecking(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [unValue, unEditing]);

  const startUsernameEdit = () => {
    setUnValue(user?.username || '');
    setUnEditing(true);
    setUnMessage('');
    setUnError('');
  };

  const saveUsername = async (e) => {
    e.preventDefault();
    setUnError('');
    setUnMessage('');
    setUnBusy(true);
    try {
      await setUsername(unValue);
      await refreshProfile();
      setUnEditing(false);
      setUnMessage('Username updated successfully.');
    } catch (err) {
      setUnError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update username.');
    } finally {
      setUnBusy(false);
    }
  };

  const startCooldown = useCallback((seconds = 60) => {
    setPeCooldown(seconds);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setPeCooldown((c) => Math.max(0, c - 1));
    }, 1000);
  }, []);

  const fetchVerifyStatus = useCallback(async () => {
    try {
      const res = await userApi.getPersonalEmailStatus();
      const status = res.data?.data;
      if (!status) return;
      setPeLimit(status);
      if (status.retryAfterMs > 0) {
        startCooldown(Math.max(1, Math.ceil(status.retryAfterMs / 1000)));
      }
    } catch { /* ignore */ }
  }, [startCooldown]);

  useEffect(() => {
    fetchVerifyStatus();
  }, [fetchVerifyStatus]);

  useEffect(() => {
    if (peCooldown === 0 && cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
  }, [peCooldown]);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const startPeEdit = () => {
    setPeEmail(user?.personalEmail || '');
    setPeEditing(true);
    setPeMessage('');
    setPeError('');
  };

  const sendVerification = async () => {
    const email = peEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPeError('Please enter a valid email address.');
      return;
    }
    setPeBusy(true);
    setPeError('');
    setPeMessage('');
    try {
      await userApi.updateProfile({ personalEmail: email });
      await refreshProfile();
      setPeEditing(false);
      setPeMessage(`Verification link sent to ${email}. Please check your inbox.`);
      startCooldown();
      fetchVerifyStatus();
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to send verification email.');
      fetchVerifyStatus();
    } finally {
      setPeBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!user?.personalEmail) return;
    setPeAction('resend');
    setPeError('');
    setPeMessage('');
    try {
      await userApi.updateProfile({ personalEmail: user.personalEmail });
      setPeMessage(`Verification email sent to ${user.personalEmail}.`);
      startCooldown();
      fetchVerifyStatus();
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to resend email.');
      fetchVerifyStatus();
    } finally {
      setPeAction('');
    }
  };

  const removePersonalEmail = async () => {
    if (!window.confirm('Remove your personal email? You can link it again anytime.')) return;
    setPeAction('remove');
    setPeError('');
    setPeMessage('');
    try {
      await userApi.updateProfile({ personalEmail: null });
      await refreshProfile();
      setPeMessage('Personal email unlinked.');
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to remove personal email.');
    } finally {
      setPeAction('');
    }
  };

  useEffect(() => {
    storeApi.getAllBadges().then((res) => {
      const map = {};
      res.data?.data?.forEach((b) => (map[b.id] = b));
      setBadgeMap(map);
    }).catch(() => {});
  }, []);

  const academicInfo = useMemo(() => parseStudentEmail(user?.email), [user?.email]);

  const startEdit = async () => {
    setForm({
      displayName: user?.displayName || '',
      bio: user?.bio || '',
      cfHandle: user?.cfHandle || '',
    });
    setSelectedBadges(user?.displayBadges || []);
    setEditing(true);
    setMessage('');
    try {
      const res = await storeApi.getInventory();
      setInventory(res.data.data || []);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await userApi.updateProfile({
        ...form,
        displayBadges: selectedBadges,
      });
      await refreshProfile();
      setEditing(false);
      setMessage('Profile updated successfully!');
    } catch (err) {
      setMessage(err.response?.data?.error?.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) return setMessage('Only JPEG, PNG, and WebP images are supported.');
    if (file.size > 5 * 1024 * 1024) return setMessage('Image size must be under 5MB.');

    setUploadingAvatar(true);
    setMessage('');
    try {
      const res = await userApi.uploadAvatar(file);
      const updatedUser = res?.data?.data;
      if (updatedUser) {
        setUser(updatedUser);
      }
      await refreshProfile();
      setMessage('Avatar updated successfully!');
    } catch {
      setMessage('Failed to upload avatar.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadingAvatar(false);
    }
  };

  if (!user) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto py-12 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin mx-auto" />
      </div>
    );
  }

  const successMsg = message.includes('success') || message.includes('updated');

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)]">User Profile</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Manage your identity and campus credentials</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ring-badge-${Math.min(user.globalRing, 3)}`}>
          Ring {user.globalRing} • {RING_LABELS[user.globalRing] || 'Member'}
        </span>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3.5 rounded-2xl text-xs font-semibold mb-6 flex items-center gap-2 ${
            successMsg
              ? 'bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 text-[var(--color-success)]'
              : 'bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/30 text-[var(--color-danger)]'
          }`}
        >
          <span>{message}</span>
        </motion.div>
      )}

      {/* Avatar & Main Identity Card */}
      <div className="glass-card p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="relative group flex-shrink-0">
            <Avatar
              src={user.avatarUrl}
              name={user.displayName}
              className="w-24 h-24 rounded-3xl object-cover ring-2 ring-[var(--color-border)] shadow-md text-3xl"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 rounded-3xl bg-black/50 backdrop-blur-xs flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="Upload new avatar"
            >
              {uploadingAvatar ? <Loader2 size={18} className="animate-spin" /> : <Camera size={20} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} className="hidden" />
          </div>

          <div className="text-center sm:text-left flex-1 min-w-0">
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)] truncate">{user.displayName}</h2>
            <p className="text-xs text-[var(--color-text-muted)] break-all mt-0.5">{user.email}</p>

            {unEditing ? (
              <div className="mt-2.5">
                <form onSubmit={saveUsername} className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-[220px]">
                    <AtSign size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      value={unValue}
                      onChange={(e) => setUnValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      minLength={3}
                      maxLength={30}
                      required
                      autoFocus
                      className="matte-input text-xs pl-8 py-1.5"
                    />
                  </div>
                  <button type="submit" disabled={unBusy || !unAvailable} className="btn btn-primary text-xs px-3 py-1.5" title="Save">
                    {unBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  </button>
                  <button type="button" onClick={() => setUnEditing(false)} className="btn btn-secondary text-xs px-2.5 py-1.5" title="Cancel">
                    <X size={12} />
                  </button>
                </form>
                <div className="mt-1 text-xs h-4">
                  {unChecking && <span className="text-[var(--color-text-muted)] text-[11px] animate-pulse">Checking availability...</span>}
                  {!unChecking && unAvailable === true && <span className="text-[var(--color-success)] text-[11px] font-bold">Handle available</span>}
                  {!unChecking && unAvailable === false && <span className="text-[var(--color-danger)] text-[11px] font-bold">Handle taken</span>}
                  {unError && <span className="text-[var(--color-danger)] text-[11px]">{unError}</span>}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 flex items-center justify-center sm:justify-start gap-1.5">
                <span className="font-semibold">{user.username ? `@${user.username}` : 'No username set'}</span>
                <button onClick={startUsernameEdit} className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5 text-[11px] font-semibold">
                  <Pencil size={11} /> Change
                </button>
              </p>
            )}

            {unMessage && <p className="text-xs text-[var(--color-success)] mt-1 font-semibold">{unMessage}</p>}

            {/* Display Badges */}
            {user.displayBadges?.length > 0 && (
              <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3.5">
                {user.displayBadges.map((badgeId) => {
                  const badge = badgeMap[badgeId];
                  if (!badge) return null;
                  return (
                    <img
                      key={badgeId}
                      src={resolveAsset(badge.imageUrl)}
                      alt={badge.name}
                      title={badge.name}
                      className="w-8 h-8 object-cover rounded-xl border border-[var(--color-border)] drop-shadow-sm"
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-3 sm:flex-col shrink-0">
            <div className="glass-card px-4 py-3 rounded-2xl text-center sm:min-w-[100px] border border-[var(--color-border)]">
              <p className="text-xl font-bold font-display text-gradient">
                {user.globalRing === 0 ? '∞' : (user.creditBalance ?? 0)}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-bold mt-0.5">Credits</p>
            </div>
          </div>
        </div>
      </div>

      {/* Academic Info Card */}
      {academicInfo && (
        <div className="glass-card p-6 mb-6">
          <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-4 flex items-center gap-2">
            <BookOpen size={17} className="text-[var(--color-accent)]" /> Academic Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {[
              ['Academic Branch', academicInfo.branch],
              ['Admission Year', academicInfo.yearOfAdmission],
              ['Roll Number', academicInfo.rollNumber],
            ].map(([label, value]) => (
              <div key={label} className="p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                <span className="text-[11px] text-[var(--color-text-muted)] font-medium">{label}</span>
                <p className="font-bold text-sm text-[var(--color-text-primary)] mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile Bio & Handle Details */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold font-display text-[var(--color-text-primary)]">Bio & Social</h3>
          {!editing && (
            <button onClick={startEdit} className="btn btn-secondary text-xs px-3.5 py-1.5">
              <Pencil size={13} /> Edit Details
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                maxLength={50}
                className="matte-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Bio
              </label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                maxLength={500}
                rows={3}
                className="matte-input resize-none"
              />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">{form.bio.length}/500</p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Codeforces Handle
              </label>
              <input
                type="text"
                value={form.cfHandle}
                onChange={(e) => setForm({ ...form, cfHandle: e.target.value })}
                placeholder="e.g. tourist"
                className="matte-input"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
                Showcase Badges (Max 5)
              </label>
              {inventory.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">No badges in inventory yet. Visit the Store to redeem badges.</p>
              )}
              <div className="flex flex-wrap gap-2.5">
                {Array.from(new Set(inventory.map((i) => i.badgeId))).map((badgeId) => {
                  const badgeInfo = badgeMap[badgeId];
                  if (!badgeInfo) return null;
                  const isSelected = selectedBadges.includes(badgeId);
                  return (
                    <button
                      key={badgeId}
                      type="button"
                      onClick={() => {
                        if (isSelected) setSelectedBadges(selectedBadges.filter((id) => id !== badgeId));
                        else if (selectedBadges.length < 5) setSelectedBadges([...selectedBadges, badgeId]);
                      }}
                      className={`p-1.5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 scale-105'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-card)]'
                      }`}
                      title={badgeInfo.name}
                    >
                      <img src={resolveAsset(badgeInfo.imageUrl)} alt="" className="w-9 h-9 object-cover rounded-xl" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs py-2 px-4 shadow-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Save Changes</span>
              </button>
              <button onClick={() => setEditing(false)} className="btn btn-secondary text-xs py-2 px-4">
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: BookOpen, label: 'Bio', value: user.bio || 'No bio provided.' },
              { icon: Code2, label: 'Codeforces', value: user.cfHandle || 'Not linked' },
              { icon: CreditCard, label: 'Total Balance', value: user.globalRing === 0 ? '∞ Unlimited' : `${user.creditBalance ?? 0} Credits` },
              { icon: Calendar, label: 'Member Since', value: new Date(user.createdAt).toLocaleDateString() },
            ].map((row) => (
              <div key={row.label} className="flex items-start gap-3 p-3.5 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                <div className="w-8 h-8 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
                  <row.icon size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] text-[var(--color-text-muted)] font-medium block">{row.label}</span>
                  <p className="text-xs font-semibold text-[var(--color-text-primary)] break-words mt-0.5">{row.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Personal Email Recovery Card */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] flex items-center gap-2">
            <Mail size={17} className="text-[var(--color-accent)]" /> Recovery Email
          </h3>
          {hasPersonalEmail && !peEditing && (
            <span
              className={`px-3 py-0.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                personalEmailVerified
                  ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
                  : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
              }`}
            >
              {personalEmailVerified ? <ShieldCheck size={13} /> : <MailCheck size={13} />}
              <span>{personalEmailVerified ? 'Verified' : 'Pending Verification'}</span>
            </span>
          )}
        </div>

        {peMessage && <div className="p-3 rounded-2xl bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 text-[var(--color-success)] text-xs font-semibold mb-4">{peMessage}</div>}
        {peError && <div className="p-3 rounded-2xl bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs font-semibold mb-4">{peError}</div>}

        {peEditing ? (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              We send a verification link to this address. Used strictly for secure account recovery.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="email"
                value={peEmail}
                onChange={(e) => setPeEmail(e.target.value)}
                placeholder="you@personal.com"
                className="matte-input flex-1"
              />
              <button onClick={sendVerification} disabled={peBusy || peCooldown > 0} className="btn btn-primary text-xs px-4">
                {peBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                <span>{peBusy ? 'Sending...' : peCooldown > 0 ? `Wait ${formatCooldown(peCooldown)}` : 'Send Verification'}</span>
              </button>
              <button onClick={() => setPeEditing(false)} className="btn btn-secondary text-xs px-3">
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        ) : hasPersonalEmail ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
                <Mail size={16} />
              </div>
              <div>
                <p className="font-semibold text-xs text-[var(--color-text-primary)] break-all">{user.personalEmail}</p>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  {personalEmailVerified ? 'Confirmed recovery email.' : 'Pending token verification in your inbox.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {!personalEmailVerified && (
                <button
                  onClick={resendVerification}
                  disabled={peAction === 'resend' || peCooldown > 0}
                  className="btn btn-secondary text-xs px-3 py-1.5"
                >
                  {peAction === 'resend' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  <span>{peCooldown > 0 ? `Wait ${formatCooldown(peCooldown)}` : 'Resend'}</span>
                </button>
              )}
              <button onClick={startPeEdit} className="btn btn-secondary text-xs px-3 py-1.5">
                <Pencil size={13} /> Change
              </button>
              <button
                onClick={removePersonalEmail}
                disabled={peAction === 'remove'}
                className="btn btn-secondary text-xs px-3 py-1.5 text-[var(--color-danger)]"
              >
                {peAction === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Remove</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-[var(--color-text-secondary)]">
              Add a personal email to maintain account recovery beyond institutional domain lifecycle.
            </p>
            <button onClick={startPeEdit} className="btn btn-secondary text-xs px-3.5 py-1.5">
              <Mail size={13} /> Add Recovery Email
            </button>
          </div>
        )}
      </div>

      {/* Cohort Tags */}
      <div className="glass-card p-6">
        <h3 className="text-base font-bold font-display text-[var(--color-text-primary)] mb-4">Assigned Cohorts</h3>
        {user.cohortTags?.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.cohortTags.map((tag, i) => (
              <motion.span
                key={tag}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="px-3.5 py-1 rounded-full text-xs font-bold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30"
              >
                #{tag}
              </motion.span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">No cohort tags assigned.</p>
        )}
      </div>
    </div>
  );
}
