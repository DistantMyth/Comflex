import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, GraduationCap, AlertCircle, ShieldCheck } from 'lucide-react';
import { useGoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/AuthShell';
import GoogleAuthButton from '../components/GoogleAuthButton';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function GoogleRegisterTrigger({ onSuccess, onError, loading }) {
  const triggerSignup = useGoogleLogin({
    onSuccess,
    onError: (err) => {
      console.error('[GoogleAuth] Registration error:', err);
      onError('Google registration was interrupted or failed.');
    },
    flow: 'implicit',
  });

  return (
    <GoogleAuthButton
      onClick={() => triggerSignup()}
      isLoading={loading}
      text="Continue with Google"
      loadingText="Configuring cohort identity..."
    />
  );
}

export default function RegisterPage() {
  const { googleLogin, systemStatus } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSuccess = async (response) => {
    setError('');
    setLoading(true);
    try {
      const payload = response?.credential
        ? { idToken: response.credential }
        : { accessToken: response?.access_token };
      const result = await googleLogin(payload);
      navigate(result.needsPassword || result.needsUsername ? '/set-password' : '/profile', { state: { needsUsername: result.needsUsername } });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Registration failed. Please make sure you use your official college email.');
    } finally {
      setLoading(false);
    }
  };

  if (systemStatus && !systemStatus.isConfigured) {
    return (
      <AuthShell title="Setup Pending">
        <div className="text-center py-6">
          <div className="w-14 h-14 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center mx-auto mb-4 border border-[var(--palette-teal)]/30">
            <GraduationCap size={28} />
          </div>
          <h3 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-2">Registration Not Open</h3>
          <p className="text-[var(--color-text-secondary)] text-xs leading-relaxed max-w-sm mx-auto">
            The platform is awaiting initial institution configuration by an administrator. Student registration will automatically open once setup is concluded.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join Comflex"
      subtitle="Sign up with your official college Google account"
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
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 p-3.5 rounded-2xl bg-[var(--color-danger)]/12 border border-[var(--color-danger)]/25 text-[var(--color-danger)] text-xs font-semibold flex items-center gap-2"
        >
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      <div className="flex flex-col items-center gap-5 py-4 w-full">
        {GOOGLE_CLIENT_ID ? (
          <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <GoogleRegisterTrigger
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google sign in failed. Please try again.')}
              loading={loading}
            />
          </GoogleOAuthProvider>
        ) : (
          <GoogleAuthButton
            onClick={() => setError('Google Sign-In is temporarily unavailable. Please sign in with your college credentials or contact your administrator.')}
            isLoading={loading}
            text="Continue with Google"
          />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)] animate-pulse">
            <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
            <span>Configuring your cohort identity...</span>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] leading-relaxed flex items-start gap-2.5">
        <ShieldCheck size={18} className="text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
        <div>
          <strong className="text-[var(--color-text-secondary)]">Institutional Verification:</strong> We securely authenticate university domain emails to ensure all students are assigned to their verified academic cohort.
        </div>
      </div>
    </AuthShell>
  );
}
