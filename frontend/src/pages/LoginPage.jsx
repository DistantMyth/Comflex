import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn, Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useGoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import AuthShell from '../components/AuthShell';
import GoogleAuthButton from '../components/GoogleAuthButton';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function GoogleButtonTrigger({ onSuccess, onError, loading }) {
  const triggerLogin = useGoogleLogin({
    onSuccess,
    onError: () => onError('Google login was interrupted or failed.'),
    flow: 'implicit',
  });

  return (
    <GoogleAuthButton
      onClick={() => triggerLogin()}
      isLoading={loading}
      text="Continue with Google"
      loadingText="Signing in with Google..."
    />
  );
}

function GoogleButtonWrapper({ clientId, onSuccess, onError, loading }) {
  if (!clientId) {
    return (
      <GoogleAuthButton
        onClick={() => onError('Google Sign-In is not configured in client environment. Please enter your email and password below.')}
        isLoading={loading}
        text="Continue with Google"
      />
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <GoogleButtonTrigger onSuccess={onSuccess} onError={onError} loading={loading} />
    </GoogleOAuthProvider>
  );
}

export default function LoginPage() {
  const { login, googleLogin, isAuthenticated, systemStatus, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/profile" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      navigate(result?.needsUsername ? '/set-password' : '/profile', { state: { needsUsername: result?.needsUsername } });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const result = await googleLogin(credentialResponse.credential);
      navigate(result.needsPassword || result.needsUsername ? '/set-password' : '/profile', { state: { needsUsername: result.needsUsername } });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Google login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={systemStatus?.institutionName || 'Sign in to access your campus community'}
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-[var(--color-accent)] font-semibold hover:underline">
            Register with College Email
          </Link>
        </>
      }
    >
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

      {/* Continue with Google */}
      <div className="mb-6">
        <GoogleButtonWrapper
          clientId={GOOGLE_CLIENT_ID}
          onSuccess={handleGoogleSuccess}
          onError={setError}
          loading={loading}
        />
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[var(--color-border)]" />
          <span className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold">
            or sign in with password
          </span>
          <div className="flex-1 h-px bg-[var(--color-border)]" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-bold uppercase tracking-wider">
            Email Address
          </label>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rollno@institution.edu"
              autoComplete="email"
              required
              autoFocus
              className="matte-input pl-10"
            />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-bold uppercase tracking-wider">
            Password
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              minLength={8}
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

        <div className="text-right">
          <Link to="/forgot-password" className="text-xs text-[var(--color-accent)] font-semibold hover:underline">
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 mt-2 shadow-md">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          <span>{loading ? 'Signing in...' : 'Sign In'}</span>
        </button>
      </form>
    </AuthShell>
  );
}
