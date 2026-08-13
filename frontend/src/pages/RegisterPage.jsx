/**
 * RegisterPage — Google-only registration flow.
 * After successful Google auth, users set a username + password.
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, GraduationCap } from 'lucide-react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/AuthShell';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function RegisterPage() {
  const { googleLogin, systemStatus } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBlocked, setGoogleBlocked] = useState(false);

  const handleGoogleSuccess = async (credential) => {
    setError('');
    setLoading(true);
    try {
      const result = await googleLogin(credential);
      navigate(result.needsPassword || result.needsUsername ? '/set-password' : '/profile');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Registration failed. Make sure you use your college email.');
    } finally {
      setLoading(false);
    }
  };

  if (systemStatus && !systemStatus.isConfigured) {
    return (
      <AuthShell title="Not Available Yet">
        <div className="text-center py-4">
          <GraduationCap size={40} className="mx-auto mb-4 text-[var(--color-accent)]" />
          <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
            The platform hasn&apos;t been configured by an admin yet.
            <br />
            Registration will open once setup is complete.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join Comflex"
      subtitle="Sign up with your college Google account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-[var(--color-accent)] font-semibold hover:underline">
            Login here
          </Link>
        </>
      }
    >
      {error && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="alert alert-danger mb-6">
          {error}
        </motion.div>
      )}

      <div className="flex flex-col items-center gap-5 py-2">
        {GOOGLE_CLIENT_ID ? (
          <GoogleOAuthProvider
            clientId={GOOGLE_CLIENT_ID}
            onScriptLoadError={() => setGoogleBlocked(true)}
          >
            <GoogleSignInButton
              label="Sign up with Google"
              onSuccess={handleGoogleSuccess}
              onError={(msg) => setError(msg)}
            />
          </GoogleOAuthProvider>
        ) : (
          <div className="alert alert-warning text-center">
            Google OAuth is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in the frontend <code>.env</code>.
          </div>
        )}

        {googleBlocked && (
          <div className="alert alert-warning text-center text-xs">
            The Google Sign-In script was blocked (ad-blocker, VPN, or extension). Allow{' '}
            <code>accounts.google.com</code> and reload.
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] animate-pulse">
            <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
            Setting up your account...
          </div>
        )}
      </div>

      <div className="mt-4 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] leading-relaxed">
        <strong className="text-[var(--color-text-secondary)]">Why Google?</strong> We verify institutional emails
        automatically so only students from your college can join — and it&apos;s one-click fast.
      </div>
    </AuthShell>
  );
}
