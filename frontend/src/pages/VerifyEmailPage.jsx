import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MailCheck, MailX, Loader2, ShieldCheck, KeyRound, Home } from 'lucide-react';
import { authApi } from '../api/authApi';
import AuthShell from '../components/AuthShell';
import { useAuth } from '../hooks/useAuth';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const { user, refreshProfile } = useAuth();

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token. Please click the link sent to your inbox.');
      return;
    }
    authApi
      .verifyPersonalEmail(token)
      .then(async (res) => {
        if (!mounted) return;
        setStatus('success');
        setMessage(res.data?.data?.message || 'Personal email verified successfully!');
        if (user) {
          try {
            await refreshProfile();
          } catch { /* non-fatal */ }
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setStatus('error');
        setMessage(err.response?.data?.error?.message || 'This verification link is invalid or has expired.');
      });
    return () => {
      mounted = false;
    };
  }, [token, user, refreshProfile]);

  return (
    <AuthShell
      title={status === 'success' ? 'Email Verified' : status === 'error' ? 'Verification Failed' : 'Verifying Email...'}
      subtitle={
        status === 'success'
          ? message
          : status === 'error'
            ? message
            : 'Validating token with server...'
      }
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex justify-center mb-6"
      >
        {status === 'loading' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent)]/15 flex items-center justify-center border border-[var(--color-accent)]/30">
            <Loader2 size={28} className="animate-spin text-[var(--color-accent)]" />
          </div>
        )}
        {status === 'success' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-success)]/15 flex items-center justify-center text-[var(--color-success)] border border-[var(--color-success)]/30">
            <MailCheck size={32} />
          </div>
        )}
        {status === 'error' && (
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-danger)]/15 flex items-center justify-center text-[var(--color-danger)] border border-[var(--color-danger)]/30">
            <MailX size={32} />
          </div>
        )}
      </motion.div>

      <div className="flex flex-col gap-3 pt-2">
        {status !== 'loading' && (
          <>
            <Link to="/profile" className="btn btn-primary justify-center shadow-md">
              <ShieldCheck size={16} /> Go to Profile
            </Link>
            {status === 'error' && (
              <Link to="/profile" className="btn btn-secondary justify-center">
                <KeyRound size={16} /> Resend from Profile
              </Link>
            )}
            <Link to="/" className="btn btn-secondary justify-center">
              <Home size={16} /> Back to Homepage
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
