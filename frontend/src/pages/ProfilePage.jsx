/**
 * ProfilePage — User's own profile with avatar, bio, tags, and badges.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Camera, Pencil, Save, X, CreditCard, Calendar, BookOpen, Code2, Loader2, Mail, MailCheck, ShieldCheck, Send, RotateCcw, Trash2, AtSign, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { userApi } from '../api/userApi';
import { storeApi } from '../api/storeApi';
import { parseIIITLEmail } from '../utils/parseEmail';
import Avatar from '../components/Avatar';
import resolveAsset from '../utils/resolveAsset';

const RING_LABELS = ['Admin', 'Manager', 'Elevated Member', 'Member'];

// Format a countdown seconds value for the button label
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
  const [peAction, setPeAction] = useState(''); // 'resend' | 'remove' | ''
  const [peMessage, setPeMessage] = useState('');
  const [peError, setPeError] = useState('');
  const [peCooldown, setPeCooldown] = useState(0); // seconds until resend allowed
  const cooldownRef = useRef(null);
  const [peLimit, setPeLimit] = useState(null); // { remaining, retryAfterMs, maxSends } from backend

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

  // Username availability check with debounce (mirrors SetPasswordPage)
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
      setUnMessage('Username updated.');
    } catch (err) {
      setUnError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update username.');
    } finally {
      setUnBusy(false);
    }
  };

  // Start a cooldown countdown. Defaults to the client-side 60s guard; the
  // backend's accurate retryAfter overrides it when the per-user limit is hit.
  const startCooldown = useCallback((seconds = 60) => {
    setPeCooldown(seconds);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setPeCooldown((c) => Math.max(0, c - 1));
    }, 1000);
  }, []);

  // Fetch the backend's rate-limit state for this user and seed the countdown
  // with the accurate server-side wait when sends are exhausted.
  const fetchVerifyStatus = useCallback(async () => {
    try {
      const res = await userApi.getPersonalEmailStatus();
      const status = res.data?.data;
      if (!status) return;
      setPeLimit(status);
      if (status.retryAfterMs > 0) {
        startCooldown(Math.max(1, Math.ceil(status.retryAfterMs / 1000)));
      }
    } catch {
      /* ignore */
    }
  }, [startCooldown]);

  useEffect(() => {
    fetchVerifyStatus();
  }, [fetchVerifyStatus]);

  // Stop the countdown timer when it reaches zero
  useEffect(() => {
    if (peCooldown === 0 && cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
  }, [peCooldown]);

  // Clear the cooldown timer on unmount
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
      setPeMessage(`Verification email sent to ${email}. Check your inbox.`);
      startCooldown();
      fetchVerifyStatus(); // sync with the backend limit (may extend the wait)
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to send verification email.');
      fetchVerifyStatus(); // pick up the server-side wait if we got rate-limited
    } finally {
      setPeBusy(false);
    }
  };

  // One-click resend — re-sends the verification link to the existing email
  const resendVerification = async () => {
    if (!user?.personalEmail) return;
    setPeAction('resend');
    setPeError('');
    setPeMessage('');
    try {
      await userApi.updateProfile({ personalEmail: user.personalEmail });
      setPeMessage(`Verification email sent to ${user.personalEmail}. Check your inbox.`);
      startCooldown();
      fetchVerifyStatus(); // sync with the backend limit (may extend the wait)
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to resend verification email.');
      fetchVerifyStatus(); // pick up the server-side wait if we got rate-limited
    } finally {
      setPeAction('');
    }
  };

  // Remove the personal email entirely
  const removePersonalEmail = async () => {
    if (!window.confirm('Remove your personal email? You can add it again later.')) return;
    setPeAction('remove');
    setPeError('');
    setPeMessage('');
    try {
      await userApi.updateProfile({ personalEmail: null });
      await refreshProfile();
      setPeMessage('Personal email removed.');
    } catch (err) {
      setPeError(err.response?.data?.error?.message || 'Failed to remove personal email.');
    } finally {
      setPeAction('');
    }
  };

  useEffect(() => {
    storeApi.getAllBadges().then((res) => {
      const map = {};
      res.data.data.forEach((b) => (map[b.id] = b));
      setBadgeMap(map);
    }).catch(() => {});
  }, []);

  const academicInfo = useMemo(() => parseIIITLEmail(user?.email), [user?.email]);

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
    } catch { /* ignore inventory errors */ }
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
    if (!allowed.includes(file.type)) return setMessage('Only JPEG, PNG, and WebP images are allowed.');
    if (file.size > 5 * 1024 * 1024) return setMessage('File must be under 5MB.');

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
      <div className="space-y-4">
        <div className="skeleton h-28 w-28 rounded-full mx-auto" />
        <div className="skeleton h-6 w-48 mx-auto" />
        <div className="skeleton h-4 w-64 mx-auto" />
      </div>
    );
  }

  const successMsg = message.includes('success') || message.includes('updated');

  return (
    <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-7">
          <h1 className="text-2xl font-bold font-display">My Profile</h1>
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold text-white ring-badge-${Math.min(user.globalRing, 3)}`}>
            Ring {user.globalRing} · {RING_LABELS[user.globalRing] || 'Restricted'}
          </span>
        </div>

        {message && (
          <div className={`alert mb-6 ${successMsg ? 'alert-success' : 'alert-danger'}`}>
            {message}
          </div>
        )}

        {/* Avatar + identity */}
        <div className="glass-card p-6 mb-6 hover-lift">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative group">
              <Avatar
                src={user.avatarUrl}
                name={user.displayName}
                className="w-28 h-28 rounded-full object-cover border-2 border-[var(--color-border)] avatar-glow text-3xl"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Change avatar"
              >
                {uploadingAvatar ? <Loader2 size={18} className="animate-spin" /> : <Camera size={20} />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} className="hidden" />
            </div>

            <div className="text-center sm:text-left flex-1 min-w-0">
              <h2 className="text-xl font-bold font-display truncate">{user.displayName}</h2>
              <p className="text-[var(--color-text-secondary)] text-sm break-all">{user.email}</p>
              {unEditing ? (
                <div className="mt-2">
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
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg focus:outline-[var(--color-accent)]"
                      />
                    </div>
                    <button type="submit" disabled={unBusy || !unAvailable} className="btn btn-primary text-xs px-3 py-1.5 shrink-0" title="Save username">
                      {unBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    </button>
                    <button type="button" onClick={() => setUnEditing(false)} className="btn btn-secondary text-xs px-3 py-1.5 shrink-0" title="Cancel">
                      <X size={13} />
                    </button>
                  </form>
                  <div className="mt-1 text-xs h-4">
                    {unChecking && <span className="text-[var(--color-text-muted)] animate-pulse inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Checking...</span>}
                    {!unChecking && unAvailable === true && <span className="text-[var(--color-success)] inline-flex items-center gap-1"><Check size={11} /> Available</span>}
                    {!unChecking && unAvailable === false && <span className="text-[var(--color-danger)] inline-flex items-center gap-1"><X size={11} /> Taken</span>}
                    {unError && <span className="text-[var(--color-danger)]">{unError}</span>}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 flex items-center justify-center sm:justify-start gap-1.5">
                  {user.username ? `@${user.username}` : 'No username yet'}
                  <button onClick={startUsernameEdit} className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5" title="Change username (once per month)">
                    <Pencil size={11} /> Change
                  </button>
                </p>
              )}
              {unMessage && <p className="text-xs text-[var(--color-success)] mt-1">{unMessage}</p>}

              {user.displayBadges?.length > 0 && (
                <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
                  {user.displayBadges.map((badgeId) => {
                    const badge = badgeMap[badgeId];
                    if (!badge) return null;
                    return (
                      <img
                        key={badgeId}
                        src={resolveAsset(badge.imageUrl)}
                        alt={badge.name}
                        title={badge.name}
                        className="w-9 h-9 object-cover rounded-lg drop-shadow-lg"
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-3 sm:flex-col shrink-0">
              <div className="glass-card px-4 py-3 rounded-2xl !shadow-none text-center sm:min-w-[110px]">
                <p className="text-lg font-bold font-display gradient-text">
                  {user.globalRing === 0 ? '∞' : (user.creditBalance ?? 0)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Credits</p>
              </div>
            </div>
          </div>
        </div>

        {/* Academic Info */}
        {academicInfo && (
          <div className="glass-card p-6 mb-6">
            <h3 className="text-lg font-semibold font-display mb-4 flex items-center gap-2">
              <BookOpen size={17} className="text-[var(--color-accent)]" /> Academic Info
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                ['Branch', academicInfo.branch],
                ['Year of Admission', academicInfo.yearOfAdmission],
                ['Roll Number', academicInfo.rollNumber],
              ].map(([label, value]) => (
                <div key={label} className="p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
                  <p className="font-semibold mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Details */}
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold font-display">Details</h3>
            {!editing && (
              <button onClick={startEdit} className="btn btn-secondary text-xs px-3 py-2">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Display Name</label>
                <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={50} />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Bio</label>
                <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={500} rows={3} className="w-full resize-none" />
                <p className="text-xs text-[var(--color-text-muted)] mt-1 text-right">{form.bio.length}/500</p>
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Codeforces Handle</label>
                <input type="text" value={form.cfHandle} onChange={(e) => setForm({ ...form, cfHandle: e.target.value })} placeholder="your_cf_handle" />
              </div>

              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Display Badges (Max 5)</label>
                {inventory.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No badges in inventory.</p>}
                <div className="flex flex-wrap gap-3">
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
                        className={`p-2 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 scale-105'
                            : 'border-transparent bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-card)]'
                        }`}
                        title={badgeInfo.name}
                      >
                        <img src={resolveAsset(badgeInfo.imageUrl)} alt="" className="w-10 h-10 object-cover rounded-lg" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={handleSave} disabled={saving} className="btn btn-primary">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Save Changes
                </button>
                <button onClick={() => setEditing(false)} className="btn btn-secondary">
                  <X size={15} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              {[
                { icon: BookOpen, label: 'Bio', value: user.bio || 'No bio set.' },
                { icon: Code2, label: 'Codeforces', value: user.cfHandle || 'Not linked' },
                { icon: CreditCard, label: 'Credits', value: user.globalRing === 0 ? '∞' : (user.creditBalance ?? 0) },
                { icon: Calendar, label: 'Joined', value: new Date(user.createdAt).toLocaleDateString() },
              ].map((row) => (
                <div key={row.label} className="flex gap-3 items-start">
                  <span className="w-8 h-8 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
                    <row.icon size={15} />
                  </span>
                  <div className="min-w-0">
                    <span className="text-xs text-[var(--color-text-muted)] block">{row.label}</span>
                    <p className="text-sm text-[var(--color-text-secondary)] break-words">{row.value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Personal Email */}
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-lg font-semibold font-display flex items-center gap-2">
              <Mail size={17} className="text-[var(--color-accent)]" /> Personal Email
            </h3>
            {hasPersonalEmail && !peEditing && (
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                  personalEmailVerified
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                    : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                }`}
              >
                {personalEmailVerified ? <ShieldCheck size={13} /> : <MailCheck size={13} />}
                {personalEmailVerified ? 'Verified' : 'Pending verification'}
              </span>
            )}
          </div>

          {peMessage && <div className="alert alert-success mb-4">{peMessage}</div>}
          {peError && <div className="alert alert-danger mb-4">{peError}</div>}

          {peEditing ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                We'll send a one-time verification link to this address. It stays private and is only used for account recovery.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={peEmail}
                  onChange={(e) => setPeEmail(e.target.value)}
                  placeholder="you@personal.com"
                  className="flex-1"
                />
                <button onClick={sendVerification} disabled={peBusy || peCooldown > 0} className="btn btn-primary">
                  {peBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {peBusy ? 'Sending…' : peCooldown > 0 ? `Try again in ${formatCooldown(peCooldown)}` : hasPersonalEmail ? 'Resend & update' : 'Send verification'}
                </button>
                <button onClick={() => setPeEditing(false)} className="btn btn-secondary">
                  <X size={15} /> Cancel
                </button>
              </div>
            </div>
          ) : hasPersonalEmail ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
                  <Mail size={16} />
                </span>
                <div>
                  <p className="font-semibold break-all">{user.personalEmail}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {personalEmailVerified
                      ? 'This address is confirmed.'
                      : 'Check your inbox for the verification link.'}
                  </p>
                  {peLimit && peLimit.remaining < peLimit.maxSends && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1 opacity-80">
                      {peLimit.remaining} of {peLimit.maxSends} verification emails left in this window
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {!personalEmailVerified && (
                  <button
                    onClick={resendVerification}
                    disabled={peAction === 'resend' || peCooldown > 0}
                    className="btn btn-secondary text-xs px-3 py-2"
                    title={peCooldown > 0 ? `Try again in ${formatCooldown(peCooldown)}` : 'Send a new verification link'}
                  >
                    {peAction === 'resend' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    {peCooldown > 0 ? `Try again in ${formatCooldown(peCooldown)}` : 'Resend'}
                  </button>
                )}
                <button onClick={startPeEdit} className="btn btn-secondary text-xs px-3 py-2">
                  <Pencil size={13} /> Change
                </button>
                <button
                  onClick={removePersonalEmail}
                  disabled={peAction === 'remove'}
                  className="btn btn-secondary text-xs px-3 py-2 text-[var(--color-danger)]"
                  title="Remove personal email"
                >
                  {peAction === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-[var(--color-text-muted)]">
                Add a personal email for account recovery outside your institution.
              </p>
              <button onClick={startPeEdit} className="btn btn-secondary text-xs px-3 py-2">
                <Mail size={13} /> Add email
              </button>
            </div>
          )}
        </div>

        {/* Cohort Tags */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold font-display mb-4">Cohort Groups</h3>
          {user.cohortTags?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {user.cohortTags.map((tag, i) => (
                <motion.span
                  key={tag}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="px-3.5 py-1.5 chip-accent rounded-full text-sm font-medium"
                >
                  {tag}
                </motion.span>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-text-muted)] text-sm">No cohort tags assigned.</p>
          )}
        </div>
      </div>
  );
}
