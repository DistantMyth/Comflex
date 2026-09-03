/**
 * Auth Context — Global authentication state provider.
 */

import { createContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/authApi';
import { userApi } from '../api/userApi';
import { adminApi } from '../api/adminApi';
import { getAccessToken, setAccessToken, clearAccessToken, refreshAccessToken } from '../api/client';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const statusRes = await adminApi.getSystemStatus();
        setSystemStatus(statusRes.data?.data || null);
      } catch {
        // Non-critical: system status not loaded
      }

      try {
        let token = getAccessToken();
        if (!token) {
          try {
            token = await refreshAccessToken();
          } catch {
            token = null;
          }
        }

        if (token) {
          const profileRes = await userApi.getProfile();
          setUser(profileRes.data.data);
        }
      } catch {
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
    const profileRes = await userApi.getProfile();
    setUser(profileRes.data.data);
    return res.data.data;
  }, []);

  const setUsernameFn = useCallback(async (username) => {
    const res = await authApi.setUsername(username);
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
    const updated = res.data.data;
    setUser(updated);
    return updated;
  }, []);

  const value = {
    user,
    setUser,
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

export default AuthContext;
