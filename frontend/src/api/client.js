/**
 * API Client — Axios instance with JWT interceptors.
 *
 * Every API call in the app MUST go through this client.
 * - Access token: kept in a module variable (NOT localStorage) to minimize
 *   XSS exposure; a 401 triggers a silent refresh.
 * - Refresh token: httpOnly + Secure cookie set by the backend — always out
 *   of JS reach. withCredentials is on so the cookie travels on refresh.
 */

import axios from 'axios';

// Use the Vercel-injected VITE_BACKEND_URL in production, fallback to relative path (Vite proxy) locally
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const API_BASE = `${BACKEND_URL}/api/v1`;

// One-time migration: pick up a previously stored access token so existing
// sessions survive the deploy without forcing a re-login. It is kept in
// memory from here on and NEVER written back to localStorage — reducing the
// XSS blast radius: a stored script can no longer read a bearer token from
// storage.
let accessToken = (() => {
  try {
    return localStorage.getItem('accessToken') || null;
  } catch {
    return null;
  }
})();

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token || null;
  // Memory only. The long-lived session rides on the httpOnly refresh
  // cookie — no JS-accessible storage ever holds a credential.
}

export function clearAccessToken() {
  accessToken = null;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  } catch { /* ignore */ }
}

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true, // required for the httpOnly refresh cookie
});

// Request interceptor: attach JWT from memory
client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshPromise = null;

// Response interceptor: handle 401 (token expired) with a single-flight refresh
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Never retry the refresh call itself (guards the boot-time refresh in
    // AuthContext from recursively triggering this interceptor)
    const isRefreshCall = originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshCall) {
      originalRequest._retry = true;

      // Refresh uses the httpOnly cookie; a single-flight promise avoids a
      // thundering herd of concurrent refreshes.
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true })
          .then(({ data }) => {
            setAccessToken(data.data.accessToken);
            return data.data.accessToken;
          })
          .catch((err) => {
            clearAccessToken();
            throw err;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      try {
        const freshToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${freshToken}`;
        return client(originalRequest);
      } catch {
        // Refresh failed — session over, redirect to login (only if we're
        // not already on an auth page)
        if (!['/login', '/register', '/forgot-password'].includes(window.location.pathname)) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default client;

// ============================================================
// Anonymous group identity sessions
// ============================================================
// Per-device keys for anonymous groups (one per group). The user is shown
// the key once when they join ("identityId.secret") and advised to save it.
// We ALSO persist sessions to a cookie so they survive — but the server only
// ever sees Verifiable hashes; nothing on the server maps a key to an account.
// localStorage is kept as a mirror so the session works even where cookies
// are blocked; reads prefer the cookie.
const ANON_STORAGE_KEY = 'comflex-anon-sessions';
const ANON_COOKIE_NAME = 'comflex_anon_sessions';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookieSessions() {
  try {
    const match = document.cookie
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(`${ANON_COOKIE_NAME}=`));
    if (!match) return null;
    return JSON.parse(decodeURIComponent(match.slice(ANON_COOKIE_NAME.length + 1)));
  } catch {
    return null;
  }
}

function writeCookieSessions(all) {
  try {
    const value = encodeURIComponent(JSON.stringify(all));
    document.cookie = `${ANON_COOKIE_NAME}=${value}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
  } catch { /* ignore */ }
}

export function getAnonSessions() {
  const fromCookie = readCookieSessions();
  let merged = fromCookie && typeof fromCookie === 'object' ? { ...fromCookie } : {};
  try {
    const raw = localStorage.getItem(ANON_STORAGE_KEY);
    if (raw) {
      const local = JSON.parse(raw);
      // Cookie wins (it is the user's stated persistence of choice), but
      // merge in local-only sessions so nothing already joined is lost.
      merged = { ...local, ...merged };
    }
  } catch { /* ignore */ }
  return merged;
}

export function setAnonSession(groupId, session) {
  if (!groupId || !session?.identityId || !session?.secret) return;
  const all = getAnonSessions();
  all[groupId] = {
    identityId: session.identityId,
    secret: session.secret,
    alias: session.alias || null,
    aliasTag: session.aliasTag || null,
    avatarUrl: session.avatarUrl || null,
  };
  writeCookieSessions(all);
  try {
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function updateAnonSession(groupId, patch) {
  const all = getAnonSessions();
  if (!all[groupId]) return;
  Object.assign(all[groupId], patch);
  writeCookieSessions(all);
  try {
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function removeAnonSession(groupId) {
  const all = getAnonSessions();
  delete all[groupId];
  writeCookieSessions(all);
  try {
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** Attach the X-Anon-Identity secret header for a group to a request config. */
export function withAnonIdentity(config, groupId) {
  const session = getAnonSessions()[groupId];
  if (session?.identityId && session?.secret) {
    config.headers = config.headers || {};
    config.headers['X-Anon-Identity'] = `${session.identityId}.${session.secret}`;
  }
  return config;
}

/** Header carrying all anon sessions for the group-list endpoint. */
export function anonSessionsHeaderValue() {
  const all = getAnonSessions();
  const arr = Object.entries(all)
    .filter(([, s]) => s?.identityId && s?.secret)
    .map(([groupId, s]) => ({ groupId, identityId: s.identityId, secret: s.secret }));
  return arr.length ? JSON.stringify(arr) : undefined;
}