import { useContext } from 'react';
import { ApiError } from './apiClient';
import { AuthContext, type AuthContextValue } from './AuthContext';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
