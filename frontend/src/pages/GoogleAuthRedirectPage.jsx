/**
 * GoogleAuthRedirectPage — Landing page for Google's redirect-mode sign-in.
 *
 * Used when the popup/FedCM flows are unavailable (Brave Shields, Firefox
 * without FedCM, third-party cookies blocked). Google performs a full-page
 * redirect to `<origin>/google-auth` carrying the ID token in the URL
 * fragment (`#id_token=...`). This page extracts it, hands it to the same
 * googleLogin() used by the popup flow, and routes the user on — no backend
 * change needed.
 */

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/AuthShell';

export const GOOGLE_REDIRECT_PATH = '/google-auth';

export default function GoogleAuthRedirectPage() {
  const { googleLogin } = useAuth();
  const navigate = useNavigate();

  // The token is present in the fragment before this page's first render
  // (Google's redirect lands here with `#id_token=...`), so reading it once
  // at init is stable — no async state dance.
  const [idToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.hash.slice(1)).get('id_token');
    } catch {
      return null;
    }
  });
  const [error, setError] = useState(
    idToken ? '' : 'Google Sign-In did not return a token. Please try again.'
  );

  useEffect(() => {
    // Strip the token from the address bar before doing anything else.
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!idToken) return;

    googleLogin(idToken)
      .then((result) => {
        navigate(result.needsPassword || result.needsUsername ? '/set-password' : '/profile', { replace: true });
      })
      .catch((err) => {
        setError(
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          'Google login failed. Please try again.'
        );
      });
  }, [idToken, googleLogin, navigate]);

  return (
    <AuthShell title="Signing you in…" subtitle="One moment while we verify your Google account">
      {error ? (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="alert alert-danger w-full">{error}</div>
          <Link to="/login" className="btn btn-primary w-full">Back to login</Link>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)] py-4">
          <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
          Contacting Google…
        </div>
      )}
    </AuthShell>
  );
}