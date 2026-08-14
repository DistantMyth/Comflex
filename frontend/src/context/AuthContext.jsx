/**
 * Auth Context — Global authentication state provider.
 *
 * Provides: user, token, isAuthenticated, isAdmin, login, logout,
 * register, googleLogin, setPassword, setUsername.
 *
 * Token handling changed to match the hardened backend:
 * - Access token is held in memory via the client module (no localStorage)
 * - Refresh token lives in an httpOnly cookie set by the backend
 */

import { createContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/authApi';
import { userApi } from '../api/userApi';
import { adminApi } from '../api/adminApi';
import { getAccessToken, setAccessToken, clearAccessToken } from '../api/client';

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState(null);

  // Check if user is currently authenticated (on mount)
  useEffect(() => {
    const init = async () => {
      try {
        // Check system status first
        const statusRes = await adminApi.getSystemStatus();
        setSystemStatus(statusRes.data.data);

        // Existing access token in memory → just load the profile.
        // Otherwise attempt a silent refresh via the httpOnly cookie so a
        // fresh session survives page reloads without re-login.
        let token = getAccessToken();
        if (!token) {
          try {
            const refreshRes = await authApi.refreshToken();
            setAccessToken(refreshRes.data.data.accessToken);
            token = getAccessToken();
          } catch {
            token = null;
          }
        }

        if (token) {
          const profileRes = await userApi.getProfile();
          setUser(profileRes.data.data);
        }
      } catch {
        // Token invalid or expired — clear it
        clearAccessToken();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.login(email, password);
    const { accessToken, user: userData, needsUsername } = res.data.data;
    setAccessToken(accessToken);
    setUser(userData);
    return { user: userData, needsUsername };
  }, []);

  const register = useCallback(async (email, password, displayName) => {
    const res = await authApi.register(email, password, displayName);
    const { accessToken, user: userData } = res.data.data;
    setAccessToken(accessToken);
    setUser(userData);
    return userData;
  }, []);

  const googleLogin = useCallback(async (idToken) => {
    const res = await authApi.googleLogin(idToken);
    const { accessToken, user: userData, needsPassword, needsUsername } = res.data.data;
    setAccessToken(accessToken);
    setUser(userData);
    return { user: userData, needsPassword, needsUsername };
  }, []);

  const setPasswordFn = useCallback(async (newPassword, currentPassword) => {
    const res = await authApi.setPassword(newPassword, currentPassword);
    // Refresh the user profile to get updated hasPassword
    const profileRes = await userApi.getProfile();
    setUser(profileRes.data.data);
    return res.data.data;
  }, []);

  const setUsernameFn = useCallback(async (username) => {
    const res = await authApi.setUsername(username);
    // Refresh profile
    const profileRes = await userApi.getProfile();
    setUser(profileRes.data.data);
    return res.data.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch { /* ignore */ }
    clearAccessToken();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const res = await userApi.getProfile();
    setUser(res.data.data);
  }, []);

  const value = {
    user,
    loading,
    systemStatus,
    isAuthenticated: !!user,
    isAdmin: user?.globalRing === 0,
    isManager: user?.globalRing <= 1,
    login,
    register,
    googleLogin,
    setPassword: setPasswordFn,
    setUsername: setUsernameFn,
    logout,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}