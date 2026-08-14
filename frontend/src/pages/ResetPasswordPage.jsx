/**
 * ResetPasswordPage — Set a new password using the reset token from the URL.
 */

import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Loader2, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { authApi } from '../api/authApi';
import AuthShell from '../components/AuthShell';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) return setError('Reset token is missing. Please use the link from your email.');
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match.');
    if (form.newPassword.length < 8) return setError('Password must be at least 8 characters.');

    setLoading(true);
    try {
      await authApi.resetPassword(token, form.newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reset password. The token may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={success ? 'Password reset!' : 'Reset password'}
      subtitle={success ? undefined : 'Choose a new password for your account.'}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] font-semibold hover:underline">
          <ArrowLeft size={14} /> Back to Login
        </Link>
      }
    >
      {success ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 flex items-center justify-center">
            <CheckCircle2 size={30} className="text-[var(--color-success)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your password has been updated. Redirecting to login...
          </p>
        </motion.div>
      ) : (
        <>
          {!token && (
            <div className="alert alert-warning mb-4">
              <KeyRound size={14} className="inline mr-1.5" />
              No reset token found. Please use the link from your email.
            </div>
          )}

          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="alert alert-danger mb-4">
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-pwd" className="block text-sm text-[var(--color-text-secondary)] mb-1.5 font-medium">
                New Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="reset-pwd"
                  name="newPassword"
                  type="password"
                  value={form.newPassword}
                  onChange={handleChange}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                  autoFocus
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm" className="block text-sm text-[var(--color-text-secondary)] mb-1.5 font-medium">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="reset-confirm"
                  name="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter password"
                  required
                  className="pl-10"
                />
              </div>
            </div>

            <button type="submit" disabled={loading || !token} className="btn btn-primary w-full">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
