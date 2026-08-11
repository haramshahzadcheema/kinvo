import type {
  AuthResponse,
  LoginRequest,
  MeResponse,
  RegisterOrganizationRequest,
  UpdateMeRequest,
  UpdateOrganizationRequest,
  UpdateOrganizationResponse,
} from '@kinvo/contracts';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiPatch, apiPost, setAccessToken } from './apiClient';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';
import { refreshSession } from './sessionRefresh';

function toAuthState(response: AuthResponse | MeResponse): AuthState {
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

  const updateMe = useCallback(async (input: UpdateMeRequest) => {
    const response = await apiPatch<MeResponse>('/api/v1/auth/me', input);
    setAuth(toAuthState(response));
  }, []);

  // Only merges `organization` into the existing auth state — the
  // response is just the updated organization, not a full MeResponse
  // (see updateOrganizationResponseSchema), so user/membership stay
  // exactly as they already were rather than being blanked out.
  const updateOrganization = useCallback(async (input: UpdateOrganizationRequest) => {
    const response = await apiPatch<UpdateOrganizationResponse>('/api/v1/organizations', input);
    setAuth((prev) => (prev ? { ...prev, organization: response } : prev));
  }, []);

  const value = useMemo(
    () => ({ status, auth, login, register, logout, updateMe, updateOrganization }),
    [status, auth, login, register, logout, updateMe, updateOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
