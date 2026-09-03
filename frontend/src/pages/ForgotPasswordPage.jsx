import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Send, ArrowLeft, Loader2, MailCheck, AlertCircle } from 'lucide-react';
import { authApi } from '../api/authApi';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import AuthShell from '../components/AuthShell';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const formatCooldown = (sec) => (sec >= 60 ? `${Math.ceil(sec / 60)}m` : `${sec}s`);

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [cooldownEmail, setCooldownEmail] = useState('');
  const [limit, setLimit] = useState(null);
  const cooldownRef = useRef(null);

  const startCooldown = useCallback((seconds = 60) => {
    setCooldown(seconds);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
  }, []);

  useEffect(() => {
    if (cooldown === 0 && cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
  }, [cooldown]);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const fetchStatus = useCallback(
    async (emailAddress) => {
      try {
        const res = await authApi.resetEmailStatus(emailAddress);
        const status = res.data?.data;
        if (!status) return;
        setLimit(status);
        setCooldownEmail(emailAddress);
        if (status.retryAfterMs > 0) {
          startCooldown(Math.max(1, Math.ceil(status.retryAfterMs / 1000)));
        }
      } catch {
        /* ignore */
      }
    },
    [startCooldown]
  );

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const result = await googleLogin(credentialResponse.credential);
      navigate(result.needsPassword || result.needsUsername ? '/set-password' : '/profile', { state: { needsUsername: result.needsUsername } });
    } catch (err) {
      setError(err.response?.data?.message || 'Google login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const normalized = email.trim().toLowerCase();
    try {
      await authApi.forgotPassword(normalized);
      setSubmitted(true);
      startCooldown(60);
      fetchStatus(normalized);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Something went wrong. Please try again.');
      fetchStatus(normalized);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={submitted ? 'Check your inbox' : 'Reset Password'}
      subtitle={submitted ? undefined : 'We will send a password reset token to your verified college email.'}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] font-semibold hover:underline">
          <ArrowLeft size={14} /> Back to Login
        </Link>
      }
    >
      {submitted ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-6 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 flex items-center justify-center text-[var(--color-success)]">
            <MailCheck size={32} />
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            If an account is registered with <strong className="text-[var(--color-text-primary)]">{email}</strong>,
            we have dispatched a password reset link. Please check your spam folder if not received.
          </p>
        </motion.div>
      ) : (
        <>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 rounded-2xl bg-[var(--color-danger)]/12 border border-[var(--color-danger)]/25 text-[var(--color-danger)] text-xs font-semibold flex items-center gap-2"
            >
              <AlertCircle size={16} className="flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          {GOOGLE_CLIENT_ID && (
            <div className="mb-6">
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <div className="flex justify-center">
                  <div className="rounded-2xl overflow-hidden shadow-sm border border-[var(--color-border)]">
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError('Google login failed.')}
                      useOneTap={false}
                      text="continue_with"
                      shape="rectangular"
                      size="large"
                      width={320}
                      theme={theme === 'dark' ? 'filled_black' : 'outline'}
                    />
                  </div>
                </div>
              </GoogleOAuthProvider>
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[var(--color-border)]" />
                <span className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
                  or reset with email
                </span>
                <div className="flex-1 h-px bg-[var(--color-border)]" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-bold uppercase tracking-wider">
                College Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEmail(val);
                    if (cooldownEmail && val.trim().toLowerCase() !== cooldownEmail) {
                      clearInterval(cooldownRef.current);
                      cooldownRef.current = null;
                      setCooldown(0);
                      setLimit(null);
                    }
                  }}
                  placeholder="you@institution.edu"
                  autoComplete="email"
                  required
                  autoFocus
                  className="matte-input pl-10"
                />
              </div>
            </div>

            <button type="submit" disabled={loading || cooldown > 0} className="btn btn-primary w-full py-3 mt-2 shadow-md">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              <span>{loading ? 'Sending link...' : cooldown > 0 ? `Try again in ${formatCooldown(cooldown)}` : 'Send Reset Link'}</span>
            </button>

            {limit && limit.remaining < limit.maxSends && (
              <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">
                {limit.remaining} of {limit.maxSends} password reset emails left in this window
              </p>
            )}
          </form>
        </>
      )}
    </AuthShell>
  );
}
