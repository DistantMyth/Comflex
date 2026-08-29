/**
 * SetPasswordPage — Post-Google-registration flow.
 * Users choose a username, then set a password.
 */

import { useState, useContext, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AtSign, Lock, Check, X, Loader2, ArrowRight, UserPlus } from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import AuthShell from '../components/AuthShell';

export default function SetPasswordPage() {
  const { user, setPassword, setUsername, refreshProfile } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  // Set by Login/Register when the backend flagged the account as needing a
  // real username (new accounts, or legacy auto-generated handles).
  const needsUsername = Boolean(location.state?.needsUsername);

  const [step, setStep] = useState(() => {
    if (needsUsername) return 'username';
    return user?.username ? 'password' : 'username';
  });
  const [username, setUsernameValue] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Onboarding is only done when BOTH username and password exist.
  // hasPassword comes from the profile response; needsPassword is only
  // present on the login/googleLogin response — relying on it here caused
  // an infinite /set-password ⇄ /profile redirect loop (the "flicker").
  useEffect(() => {
    if (user?.hasPassword && user?.username && !needsUsername) navigate('/profile');
    if (user?.username && !needsUsername) setStep('password');
  }, [user, navigate, needsUsername]);

  useEffect(() => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    const timer = setTimeout(async () => {
      setUsernameChecking(true);
      try {
        const res = await authApi.checkUsername(username);
        setUsernameAvailable(res.data.data.available);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setUsernameChecking(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username]);

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setUsername(username);
      // Password accounts are done once the username is set — only
      // Google-only accounts (no password yet) continue to the password step.
      if (user?.hasPassword) {
        navigate('/profile');
      } else {
        setStep('password');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to set username.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');

    setLoading(true);
    try {
      await setPassword(password);
      await refreshProfile();
      navigate('/profile');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to set password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Almost there!"
      subtitle={step === 'username' ? 'Choose your username' : 'Set a password for your account'}
    >
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-7">
        <motion.div
          className="w-3 h-3 rounded-full"
          animate={{ backgroundColor: step === 'username' ? 'var(--color-accent)' : 'var(--color-success)' }}
        />
        <div className={`w-14 h-0.5 rounded ${step === 'password' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />
        <motion.div
          className="w-3 h-3 rounded-full"
          animate={{ backgroundColor: step === 'password' ? 'var(--color-accent)' : 'var(--color-border)' }}
        />
      </div>

      {error && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="alert alert-danger mb-5">
          {error}
        </motion.div>
      )}

      {step === 'username' ? (
        <form onSubmit={handleUsernameSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Username</label>
            <div className="relative">
              <AtSign size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="e.g. john_doe"
                value={username}
                onChange={(e) => setUsernameValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                minLength={3}
                maxLength={30}
                required
                className="pl-10"
              />
            </div>
            <div className="mt-2 text-xs h-4">
              {usernameChecking && (
                <span className="text-[var(--color-text-muted)] animate-pulse inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Checking...
                </span>
              )}
              {!usernameChecking && usernameAvailable === true && (
                <span className="text-[var(--color-success)] inline-flex items-center gap-1">
                  <Check size={13} /> Available
                </span>
              )}
              {!usernameChecking && usernameAvailable === false && (
                <span className="text-[var(--color-danger)] inline-flex items-center gap-1">
                  <X size={13} /> Already taken
                </span>
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={loading || !usernameAvailable}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Continue
          </button>
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPasswordValue(e.target.value)}
                minLength={8}
                required
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Confirm Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="pl-10"
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {loading ? 'Setting...' : 'Set Password & Continue'}
          </button>

          {user?.hasPassword && (
            <button type="button" className="btn btn-secondary w-full text-sm" onClick={() => navigate('/profile')}>
              Cancel
            </button>
          )}
        </form>
      )}
    </AuthShell>
  );
}
