/**
 * LoginPage — Email/password + Google OAuth login.
 * Redirects to /setup if the system is not configured.
 */

import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import AuthShell from '../components/AuthShell';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function LoginPage() {
  const { login, googleLogin, isAuthenticated, systemStatus, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Login failed. Please try again.');
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
      setError(err.response?.data?.message || 'Google login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={systemStatus?.institutionName || 'Sign in to your community'}
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-[var(--color-accent)] font-semibold hover:underline">
            Register
          </Link>
        </>
      }
    >
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
                text="signin_with"
                shape="pill"
                size="large"
                width={300}
                theme={document.documentElement.classList.contains('dark') ? 'filled_black' : 'filled_blue'}
              />
            </div>
          </GoogleOAuthProvider>
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-[var(--color-border)]" />
            <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">or sign in with email</span>
            <div className="flex-1 h-px bg-[var(--color-border)]" />
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="block text-sm text-[var(--color-text-secondary)] mb-1.5 font-medium">
            Email
          </label>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.edu"
              required
              autoFocus
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm text-[var(--color-text-secondary)] mb-1.5 font-medium">
            Password
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              className="pl-10"
            />
          </div>
        </div>

        <div className="text-right">
          <Link to="/forgot-password" className="text-xs text-[var(--color-accent)] hover:underline">
            Forgot your password?
          </Link>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary w-full mt-1">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </AuthShell>
  );
}
