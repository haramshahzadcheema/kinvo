import type {
  AuthResponse,
  LoginRequest,
  RegisterOrganizationRequest,
  UpdateMeRequest,
  UpdateOrganizationRequest,
} from '@kinvo/contracts';
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
  updateMe: (input: UpdateMeRequest) => Promise<void>;
  updateOrganization: (input: UpdateOrganizationRequest) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
