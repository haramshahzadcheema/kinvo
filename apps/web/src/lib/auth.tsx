import type { AuthResponse, LoginRequest, RegisterOrganizationRequest } from '@kinvo/contracts';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiPost, setAccessToken } from './apiClient';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';
import { refreshSession } from './sessionRefresh';

function toAuthState(response: AuthResponse): AuthState {
  return {
    user: response.user,
    organization: response.organization,
    membership: response.membership,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [auth, setAuth] = useState<AuthState | null>(null);

  // On first load (or a hard refresh), there's no in-memory access token —
  // but the httpOnly refresh cookie may still be valid, so attempt one
  // silent refresh before deciding the user is logged out. A 401 here is
  // the expected, non-error case of "no session," not a real failure.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((response) => {
        if (cancelled) return;
        setAccessToken(response.accessToken);
        setAuth(toAuthState(response));
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const response = await apiPost<AuthResponse>('/api/v1/auth/login', input);
    setAccessToken(response.accessToken);
    setAuth(toAuthState(response));
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (input: RegisterOrganizationRequest) => {
    const response = await apiPost<AuthResponse>('/api/v1/auth/register-organization', input);
    setAccessToken(response.accessToken);
    setAuth(toAuthState(response));
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/v1/auth/logout');
    } finally {
      setAccessToken(null);
      setAuth(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo(
    () => ({ status, auth, login, register, logout }),
    [status, auth, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
