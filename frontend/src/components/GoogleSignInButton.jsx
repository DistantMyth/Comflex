/**
 * GoogleSignInButton — Custom "Sign in with Google" pill button.
 *
 * Replaces the GIS renderButton iframe (whose logo is rendered inside a
 * white circular badge by Google's own cross-origin stylesheet, which our
 * CSS cannot touch). Uses the officially supported custom-button flow:
 * `google.accounts.id.initialize({ callback })` + `prompt()`, so the
 * credential (ID token JWT) is delivered to the same callback the old
 * GoogleLogin component used — no backend changes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGoogleOAuth } from '@react-oauth/google';
import { Loader2 } from 'lucide-react';

const GoogleGLogo = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    aria-hidden="true"
    className="flex-shrink-0"
  >
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export default function GoogleSignInButton({
  onSuccess,
  onError,
  label = 'Sign in with Google',
  width = 300,
}) {
  const { clientId, scriptLoadedSuccessfully } = useGoogleOAuth();
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const pendingRef = useRef(false);
  const safetyTimer = useRef(null);

  // The GIS script may take a moment or be blocked (network, ad-blocker,
  // CSP). A silently-disabled button looks like a dead button, so surface
  // the state: brief "loading", then an actionable message.
  useEffect(() => {
    if (scriptLoadedSuccessfully) return;
    const t = setTimeout(() => setLoadFailed(true), 10 * 1000);
    return () => clearTimeout(t);
  }, [scriptLoadedSuccessfully]);

  const notReady = !scriptLoadedSuccessfully || !window.google?.accounts?.id;

  const fire = useMemo(() => (fn, arg) => {
    if (typeof fn === 'function') fn(arg);
  }, []);

  const stopPending = () => {
    pendingRef.current = false;
    setPending(false);
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  };

  const handleClick = () => {
    if (pendingRef.current) return;
    if (notReady) {
      fire(onError, 'Google sign-in is not ready yet. Please try again in a moment.');
      return;
    }

    pendingRef.current = true;
    setPending(true);
    safetyTimer.current = setTimeout(stopPending, 90 * 1000);

    const gis = window.google.accounts.id;

    // Re-initialize on every click so a cancelled prompt can be retried.
    gis.cancel?.();
    gis.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (credentialResponse) => {
        if (!credentialResponse?.credential) {
          stopPending();
          fire(onError, 'Google sign-in was cancelled.');
          return;
        }
        stopPending();
        fire(onSuccess, credentialResponse.credential);
      },
    });

    gis.prompt((notification) => {
      // Leave pending active if the picker is being shown.
      if (!notification) return;
      if (notification.isDisplayed?.()) return;
      if (notification.isNotDisplayed?.() || notification.isSkipped?.()) {
        // Some "not displayed" notifications still resolve later via the
        // callback; only fail fast once we know why it didn't show. A
        // config problem (e.g. missing authorized JavaScript origin in
        // Google Cloud Console) surfaces here instead of dead silence.
        const reason = notification.getNotDisplayedReason?.() || notification.getSkippedReason?.() || '';
        setTimeout(() => {
          if (pendingRef.current) {
            stopPending();
            if (reason && reason !== 'user_cancel' && reason !== 'suppressed_by_user') {
              fire(onError, `Google sign-in couldn't open (${reason}). Make sure "http://localhost:5173" is an authorized JavaScript origin for this OAuth client, then try again.`);
            }
          }
        }, 500);
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || notReady}
        style={{ width }}
        className={[
          'flex items-center justify-center gap-3 h-12 rounded-full select-none font-medium text-[15px]',
          'text-white bg-[#131314] hover:bg-[#1f1f20] active:bg-[#131314]',
          'border border-[#747775]/40 border-solid',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
          'transition-colors duration-150',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {pending ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <>
            <GoogleGLogo size={18} />
            {label}
          </>
        )}
      </button>
      {notReady && (
        <span className="text-xs text-[var(--color-text-muted)] text-center" data-testid="gsi-load-state">
          {loadFailed
            ? "Couldn't load Google Sign-In — a network blocker (ad-blocker, VPN, browser extensions) or CSP may be blocking accounts.google.com. Reload the page to retry."
            : 'Loading Google Sign-In…'}
        </span>
      )}
    </div>
  );
}