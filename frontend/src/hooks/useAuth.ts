import { createContext, useContext } from 'react';

import type { AuthResult, AuthUser, LoginInput, RegisterInput } from '../lib/authApi';
import type { AuthStatus } from '../lib/authModel';
import type { RoleName } from '../lib/role';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  // The viewer's effective role: the stored role when authenticated, guest otherwise (009).
  role: RoleName;
  register: (input: RegisterInput) => Promise<AuthResult>;
  login: (input: LoginInput) => Promise<AuthResult>;
  logout: () => Promise<void>;
  // Re-probe /api/user so server-side changes (e.g. emailVerifiedAt) propagate (008).
  refresh: () => Promise<void>;
};

// The provider (components/AuthProvider) supplies the value; consumers read it via the
// useAuth hook. Context + hook live here (no component) so the provider file can satisfy
// react-refresh's component-only-export rule.
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
