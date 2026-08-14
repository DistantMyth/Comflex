/**
 * GoogleSignInButton — Custom "Sign in with Google" pill button.
 *
 * Replaces the GIS renderButton iframe (whose logo is rendered inside a
 * white circular badge by Google's own cross-origin stylesheet, which our
 * CSS cannot touch). Uses the officially supported custom-button flow:
 * `google.accounts.id.initialize({ callback })` + `prompt()`, so the
 * credential (ID token JWT) is delivered to the same callback the old
 * GoogleLogin component used — no backend changes.
 *
 * Prompt strategy (mirrors Google's recommended fallback):
 *   1. Try with `use_fedcm_for_prompt: true` — FedCM works even where
 *      third-party cookies are blocked (Chrome default) and shows a native
 *      dialog instead of a popup.
 *   2. If FedCM can't run (user opted out, browser without FedCM, ...),
 *      retry once with the classic popup flow.
 *   3. Both failing (e.g. Brave Shields or Firefox blocking both) →
 *      fall back to Google's full-page redirect flow (`ux_mode: 'redirect'`),
 *      which needs no cookies at all and always shows Google's login page.
 *      A "use Google in this window" link triggers the same redirect on
 *      demand.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGoogleOAuth } from '@react-oauth/google';
import { Loader2 } from 'lucide-react';
import { GOOGLE_REDIRECT_PATH } from '../pages/GoogleAuthRedirectPage';

// Reasons that point at the OAuth client config (not the browser) being
// broken — retrying a different flow would fail identically.
const CONFIG_FAIL_REASONS = [
  'invalid_client',
  'missing_client_id',
  'unregistered_origin',
  'secure_http_required',
];

// The only reason we treat as "the user walked away" — everything else
// (suppressed_by_user, opt_out_or_no_session, browser_not_supported, ...)
// means the browser refused to show the embedded flow, and we should try
// the next flow instead of bailing out.
const USER_CANCELLED_REASON = 'user_cancel';

function guidanceFor(reason, origin) {
  if (reason === 'invalid_client' || reason === 'missing_client_id') {
    return 'Google Sign-In is misconfigured (invalid client id). Check that GOOGLE_CLIENT_ID in the backend and frontend environment matches the OAuth client.';
  }
  if (reason === 'secure_http_required') {
    return 'Google Sign-In requires a secure origin. Open the site over HTTPS and try again.';
  }
  return `Google Sign-In couldn't run here (${reason}). Make sure "${origin}" is in the OAuth client's Authorized JavaScript origins and "${origin}/google-auth" is in its Authorized redirect URIs (Google Cloud Console \u2192 APIs & Services \u2192 Credentials). Then try again.`;
}

// The full-page redirect flow needs no cookie/FedCM support at all, so we
// drive it with a plain top-level URL rather than gis.prompt() — a direct
// navigation the browser cannot silently swallow. This is Google's
// documented OpenID Connect implicit flow (authorize endpoint,
// response_type=id_token): the ID token lands on
// `/google-auth#id_token=...`, which GoogleAuthRedirectPage hands to
// googleLogin(). nonce is required for id_token responses; state guards
// against CSRF.
const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildRedirectUrl(clientId, origin) {
  if (!clientId || !origin) return '';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}${GOOGLE_REDIRECT_PATH}`,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: randomToken(),
    state: randomToken(),
    prompt: 'select_account',
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

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
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const redirectUrl = useMemo(() => buildRedirectUrl(clientId, origin), [clientId, origin]);

  const goRedirect = () => {
    if (redirectUrl) window.location.assign(redirectUrl);
  };

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

  /**
   * One prompt attempt with the given FedCM setting. Resolves with
   *   { kind: 'success', credential } | { kind: 'cancel' } | { kind: 'failed', reason }
   * Does not throw.
   */
  const attemptPrompt = (useFedcm) =>
    new Promise((resolve) => {
      const gis = window.google.accounts.id;
      let settled = false;
      let displayed = false;
      const settle = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const failAfter = (reason) => settle({ kind: 'failed', reason });

      gis.cancel?.();
      gis.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: useFedcm,
        callback: (credentialResponse) => {
          if (!credentialResponse?.credential) {
            settle({ kind: 'cancel' });
            return;
          }
          settle({ kind: 'success', credential: credentialResponse.credential });
        },
      });

      gis.prompt((notification) => {
        if (!notification) return;
        if (notification.isDisplayed?.()) {
          displayed = true;
          return;
        }
        const reason =
          notification.getNotDisplayedReason?.() ||
          notification.getSkippedReason?.() ||
          'unknown_reason';
        // Some flows still resolve via the callback a moment later (e.g. a
        // cancelled popup) — only treat it as failed once that window passes.
        setTimeout(() => {
          if (!settled) failAfter(reason);
        }, 500);
      });

      // If the dialog neither opened nor failed within 30s, give up quietly.
      setTimeout(() => {
        if (!settled && !displayed) failAfter('unknown_reason');
      }, 30 * 1000);
    });

  const handleClick = async () => {
    if (pendingRef.current) return;
    if (notReady) {
      fire(onError, 'Google sign-in is not ready yet. Please try again in a moment.');
      return;
    }

    pendingRef.current = true;
    setPending(true);
    safetyTimer.current = setTimeout(stopPending, 90 * 1000);

    try {
      // 1. FedCM first — shows a native dialog, works with 3P cookies blocked.
      let result = await attemptPrompt(true);
      // 2. Classic popup fallback whenever FedCM was refused (suppressed_by_user,
      //    opt_out_or_no_session, ...). Only a genuine user dismissal stops here.
      if (result.kind === 'failed' && result.reason !== USER_CANCELLED_REASON) {
        result = await attemptPrompt(false);
      }

      if (result.kind === 'success') {
        fire(onSuccess, result.credential);
      } else if (result.kind === 'cancel' || result.reason === USER_CANCELLED_REASON) {
        fire(onError, 'Google sign-in was cancelled.');
      } else if (CONFIG_FAIL_REASONS.includes(result.reason)) {
        fire(onError, guidanceFor(result.reason, origin));
      } else {
        // Popup and FedCM both refused (Brave Shields, Firefox, 3P-cookie
        // blocking, ...): hand off to the cookie-free full-page redirect.
        goRedirect();
      }
    } finally {
      stopPending();
    }
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
      {!notReady && !pending && (
        <a
          href={redirectUrl || undefined}
          className="text-xs text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-accent)] transition-colors"
        >
          Google not opening? Sign in in this window instead
        </a>
      )}
    </div>
  );
}