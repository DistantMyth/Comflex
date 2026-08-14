/**
 * ForgotPasswordPage — Request a password reset link.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Send, ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { authApi } from '../api/authApi';
import { useAuth } from '../hooks/useAuth';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import AuthShell from '../components/AuthShell';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Format a countdown seconds value for the button label
const formatCooldown = (sec) => (sec >= 60 ? `${Math.ceil(sec / 60)}m` : `${sec}s`);

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0); // seconds until resend allowed
  const [cooldownEmail, setCooldownEmail] = useState(''); // email the countdown applies to
  const [limit, setLimit] = useState(null); // { remaining, maxSends } from backend
  const cooldownRef = useRef(null);

  const startCooldown = useCallback((seconds = 60) => {
    setCooldown(seconds);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
  }, []);

  // Stop the countdown timer when it reaches zero
  useEffect(() => {
    if (cooldown === 0 && cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
  }, [cooldown]);

  // Clear the cooldown timer on unmount
  useEffect(() => () => clearInterval(cooldownRef.current), []);

  // Fetch the backend's per-account reset limit and seed the countdown with
  // the accurate server-side wait when sends are exhausted.
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
      // 60s client guard immediately; fetchStatus replaces it with the accurate
      // server-side wait when the per-account quota is exhausted.
      startCooldown(60);
      fetchStatus(normalized);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Something went wrong. Please try again.');
      fetchStatus(normalized); // seed the accurate server-side wait if rate-limited
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={submitted ? 'Check your email' : 'Forgot password'}
      subtitle={submitted ? undefined : 'We&apos;ll send you a link to reset your password.'}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] font-semibold hover:underline">
          <ArrowLeft size={14} /> Back to Login
        </Link>
      }
    >
      {submitted ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 flex items-center justify-center">
            <MailCheck size={30} className="text-[var(--color-success)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            If an account exists for <strong className="text-[var(--color-text-primary)]">{email}</strong>,
            we&apos;ve sent a password reset link.
          </p>
        </motion.div>
      ) : (
        <>
          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="alert alert-danger mb-5">
              {error}
            </motion.div>
          )}

          {GOOGLE_CLIENT_ID && (
            <div className="mb-6">
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Google login failed.')}
                    useOneTap={false}
                    text="continue_with"
                    shape="pill"
                    size="large"
                    width={300}
                    theme={document.documentElement.classList.contains('dark') ? 'filled_black' : 'filled_blue'}
                  />
                </div>
              </GoogleOAuthProvider>
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">or reset with email</span>
                <div className="flex-1 h-px bg-[var(--color-border)]" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-sm text-[var(--color-text-secondary)] mb-1.5 font-medium">
                Email
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
                    // A different address has its own limit — drop stale state
                    if (cooldownEmail && val.trim().toLowerCase() !== cooldownEmail) {
                      clearInterval(cooldownRef.current);
                      cooldownRef.current = null;
                      setCooldown(0);
                      setLimit(null);
                    }
                  }}
                  placeholder="you@institution.edu"
                  required
                  autoFocus
                  className="pl-10"
                />
              </div>
            </div>

            <button type="submit" disabled={loading || cooldown > 0} className="btn btn-primary w-full">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {loading ? 'Sending...' : cooldown > 0 ? `Try again in ${formatCooldown(cooldown)}` : 'Send Reset Link'}
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
