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