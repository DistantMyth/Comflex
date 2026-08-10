/**
 * VerifyEmailPage — Handles the personal-email verification link.
 * The verification email points to /verify-email?token=... — this page
 * exchanges that token with the backend and shows the result.
 */

import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MailCheck, MailX, Loader2, ShieldCheck, KeyRound } from 'lucide-react';
import { authApi } from '../api/authApi';
import AuthShell from '../components/AuthShell';
import { useAuth } from '../hooks/useAuth';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');
  const { user, refreshProfile } = useAuth();

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token. Open the link from your verification email.');
      return;
    }
    authApi
      .verifyPersonalEmail(token)
      .then(async (res) => {
        if (!mounted) return;
        setStatus('success');
        setMessage(res.data?.data?.message || 'Email verified successfully!');
        // Keep the profile in sync if the user is already logged in
        if (user) {
          try {
            await refreshProfile();
          } catch { /* non-fatal */ }
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setStatus('error');
        setMessage(err.response?.data?.error?.message || 'This link is invalid or has expired.');
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthShell
      title={status === 'success' ? 'Email verified 🎉' : status === 'error' ? 'Verification failed' : 'Verifying your email…'}
      subtitle={
        status === 'success'
          ? message
          : status === 'error'
            ? message
            : 'This takes just a second.'
      }
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="flex justify-center mb-4"
      >
        {status === 'loading' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent)]/10 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-[var(--color-accent)]" />
          </div>
        )}
        {status === 'success' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-success)]/10 flex items-center justify-center">
            <MailCheck size={30} className="text-[var(--color-success)]" />
          </div>
        )}
        {status === 'error' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-danger)]/10 flex items-center justify-center">
            <MailX size={30} className="text-[var(--color-danger)]" />
          </div>
        )}
      </motion.div>

      <div className="flex flex-col gap-3">
        {status !== 'loading' && (
          <>
            <Link to="/profile" className="btn btn-primary justify-center">
              <ShieldCheck size={15} /> Go to my profile
            </Link>
            {status === 'error' && (
              <Link to="/profile" className="btn btn-secondary justify-center">
                <KeyRound size={15} /> Resend from profile
              </Link>
            )}
            <Link to="/" className="btn btn-secondary justify-center">
              Back to home
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
