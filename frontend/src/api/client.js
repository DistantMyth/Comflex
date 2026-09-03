/**
 * API Client — Axios instance with JWT interceptors & Anon Session Crypto.
 */

import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const API_BASE = `${BACKEND_URL}/api/v1`;

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
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshPromise = null;

export function refreshAccessToken() {
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
  return refreshPromise;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isRefreshCall = originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest?._retry && !isRefreshCall) {
      originalRequest._retry = true;

      try {
        const freshToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${freshToken}`;
        return client(originalRequest);
      } catch {
        const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
        const isPublicPage = window.location.pathname === '/' || PUBLIC_PREFIXES.some((p) => window.location.pathname.startsWith(p));
        if (!isPublicPage) {
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
// Anonymous group identity sessions (Account-Scoped)
// ============================================================
const ANON_STORAGE_KEY = 'comflex-anon-sessions';
const ANON_COOKIE_NAME = 'comflex_anon_sessions';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function safeGroupKey(groupId) {
  return typeof groupId === 'string' && OBJECT_ID_RE.test(groupId) ? groupId : null;
}

function safeUserKey(userId) {
  if (!userId || typeof userId !== 'string') return null;
  if (userId === '__proto__' || userId === 'constructor' || userId === 'prototype') return null;
  return userId;
}

export function getCurrentUserId() {
  if (!accessToken) return 'global';
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return 'global';
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || 'global';
  } catch {
    return 'global';
  }
}

function normalizeSessionsStore(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;

  const currentUid = safeUserKey(getCurrentUserId()) || 'global';

  for (const k of Object.keys(raw)) {
    const val = raw[k];
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

    if (val.identityId && val.secret) {
      if (safeGroupKey(k)) {
        result[currentUid] = result[currentUid] || {};
        result[currentUid][k] = {
          identityId: String(val.identityId),
          secret: String(val.secret),
          alias: val.alias || null,
          aliasTag: val.aliasTag || null,
          avatarUrl: val.avatarUrl || null,
        };
      }
      continue;
    }

    const validUid = safeUserKey(k);
    if (!validUid) continue;

    for (const gid of Object.keys(val)) {
      if (!safeGroupKey(gid)) continue;
      const s = val[gid];
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
      if (s.identityId && s.secret) {
        result[validUid] = result[validUid] || {};
        result[validUid][gid] = {
          identityId: String(s.identityId),
          secret: String(s.secret),
          alias: s.alias || null,
          aliasTag: s.aliasTag || null,
          avatarUrl: s.avatarUrl || null,
        };
      }
    }
  }

  return result;
}

function readAllSessions() {
  let store = {};
  try {
    const raw = localStorage.getItem(ANON_STORAGE_KEY);
    if (raw) {
      store = normalizeSessionsStore(JSON.parse(raw));
    }
  } catch { /* ignore */ }

  try {
    const match = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${ANON_COOKIE_NAME}=`));
    if (match) {
      const parsed = JSON.parse(decodeURIComponent(match.slice(ANON_COOKIE_NAME.length + 1)));
      const cookieStore = normalizeSessionsStore(parsed);
      for (const uid of Object.keys(cookieStore)) {
        store[uid] = store[uid] || {};
        for (const gid of Object.keys(cookieStore[uid])) {
          if (!store[uid][gid]) {
            store[uid][gid] = cookieStore[uid][gid];
          }
        }
      }
    }
  } catch { /* ignore */ }

  return store;
}

function writeAllSessions(store) {
  try {
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
  try {
    const value = encodeURIComponent(JSON.stringify(store));
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ANON_COOKIE_NAME}=${value}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
  } catch { /* ignore */ }
}

export function getAnonSessions(targetUserId) {
  const uid = safeUserKey(targetUserId) || getCurrentUserId();
  const all = readAllSessions();

  if (uid !== 'global' && all['global'] && Object.keys(all['global']).length > 0) {
    all[uid] = all[uid] || {};
    let migrated = false;
    for (const gid of Object.keys(all['global'])) {
      if (!all[uid][gid]) {
        all[uid][gid] = all['global'][gid];
        migrated = true;
      }
    }
    delete all['global'];
    if (migrated) {
      writeAllSessions(all);
    }
  }

  return all[uid] || {};
}

export function setAnonSession(groupId, session, targetUserId) {
  const gid = safeGroupKey(groupId);
  if (!gid || !session?.identityId || !session?.secret || !OBJECT_ID_RE.test(session.identityId)) return;
  const uid = safeUserKey(targetUserId) || getCurrentUserId();
  const all = readAllSessions();
  all[uid] = all[uid] || {};
  all[uid][gid] = {
    identityId: String(session.identityId),
    secret: String(session.secret),
    alias: session.alias || null,
    aliasTag: session.aliasTag || null,
    avatarUrl: session.avatarUrl || null,
  };
  if (uid !== 'global' && all['global']?.[gid]) {
    delete all['global'][gid];
  }
  writeAllSessions(all);
}

export function updateAnonSession(groupId, patch, targetUserId) {
  const gid = safeGroupKey(groupId);
  if (!gid || !patch || typeof patch !== 'object') return;
  const uid = safeUserKey(targetUserId) || getCurrentUserId();
  const all = readAllSessions();
  if (!all[uid] || !all[uid][gid]) {
    if (uid !== 'global' && all['global']?.[gid]) {
      all[uid] = all[uid] || {};
      all[uid][gid] = all['global'][gid];
      delete all['global'][gid];
    } else {
      return;
    }
  }
  Object.assign(all[uid][gid], patch);
  writeAllSessions(all);
}

export function removeAnonSession(groupId, targetUserId) {
  const gid = safeGroupKey(groupId);
  if (!gid) return;
  const uid = safeUserKey(targetUserId) || getCurrentUserId();
  const all = readAllSessions();
  let changed = false;
  if (all[uid] && all[uid][gid]) {
    delete all[uid][gid];
    changed = true;
  }
  if (all['global'] && all['global'][gid]) {
    delete all['global'][gid];
    changed = true;
  }
  if (changed) {
    writeAllSessions(all);
  }
}

export function withAnonIdentity(config = {}, groupId, targetUserId) {
  const cfg = config || {};
  const session = getAnonSessions(targetUserId)[groupId];
  if (session?.identityId && session?.secret) {
    cfg.headers = cfg.headers || {};
    cfg.headers['X-Anon-Identity'] = `${session.identityId}.${session.secret}`;
  }
  return cfg;
}

export function anonSessionsHeaderValue(targetUserId) {
  const all = getAnonSessions(targetUserId);
  const arr = Object.entries(all)
    .filter(([groupId, s]) => safeGroupKey(groupId) && s?.identityId && OBJECT_ID_RE.test(s.identityId) && s?.secret)
    .map(([groupId, s]) => ({ groupId, identityId: s.identityId, secret: s.secret }));
  return arr.length ? JSON.stringify(arr) : undefined;
}
