import type { AuthResponse, LoginRequest, RegisterOrganizationRequest } from '@kinvo/contracts';
import { createContext } from 'react';

export interface AuthState {
  user: AuthResponse['user'];
  organization: AuthResponse['organization'];
  membership: AuthResponse['membership'];
}

export interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  auth: AuthState | null;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterOrganizationRequest) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
