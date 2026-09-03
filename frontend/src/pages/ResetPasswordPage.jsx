import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Loader2, KeyRound, ArrowLeft, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { authApi } from '../api/authApi';
import AuthShell from '../components/AuthShell';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) return setError('Reset token is missing. Please open the link from your email.');
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match.');
    if (form.newPassword.length < 8) return setError('Password must be at least 8 characters.');
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.newPassword)) {
      return setError('Password must contain at least one uppercase letter, one lowercase letter, and one number.');
    }

    setLoading(true);
    try {
      await authApi.resetPassword(token, form.newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={success ? 'Password updated' : 'Reset Password'}
      subtitle={success ? undefined : 'Set a secure new password for your Comflex account.'}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] font-semibold hover:underline">
          <ArrowLeft size={14} /> Back to Login
        </Link>
      }
    >
      {success ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-6 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 flex items-center justify-center text-[var(--color-success)]">
            <CheckCircle2 size={32} />
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Your password has been securely updated. Redirecting to login...
          </p>
        </motion.div>
      ) : (
        <>
          {!token && (
            <div className="p-3.5 rounded-2xl bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/30 text-[var(--color-warning)] text-xs font-semibold mb-4 flex items-center gap-2">
              <KeyRound size={16} className="flex-shrink-0" />
              <span>No reset token detected in URL query.</span>
            </div>
          )}

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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-pwd" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-bold uppercase tracking-wider">
                New Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="reset-pwd"
                  name="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={form.newPassword}
                  onChange={handleChange}
                  placeholder="Min 8 characters (upper, lower, digit)"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  autoFocus
                  className="matte-input pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-bold uppercase tracking-wider">
                Confirm Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="reset-confirm"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  required
                  className="matte-input pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading || !token} className="btn btn-primary w-full py-3 mt-2 shadow-md">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              <span>{loading ? 'Updating...' : 'Set New Password'}</span>
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
