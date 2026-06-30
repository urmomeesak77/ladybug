import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { AuthContext } from '../hooks/useAuth';
import { AuthApi } from '../lib/authApi';
import type { AuthResult, AuthUser, LoginInput, RegisterInput } from '../lib/authApi';
import type { AuthStatus } from '../lib/authModel';

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [user, setUser] = useState<AuthUser | null>(null);

  // Derive auth state from the backend on load so a refresh restores the session and a
  // stale client can never present a logged-in UI without one (FR-013/FR-014).
  useEffect(() => {
    let active = true;
    AuthApi.fetchCurrentUser().then((current) => {
      if (active) {
        setUser(current);
        setStatus(current ? 'authenticated' : 'anonymous');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<AuthResult> => {
    const result = await AuthApi.register(input);
    if (result.ok) {
      setUser(result.user);
      setStatus('authenticated');
    }
    return result;
  }, []);

  const login = useCallback(async (input: LoginInput): Promise<AuthResult> => {
    const result = await AuthApi.login(input);
    if (result.ok) {
      setUser(result.user);
      setStatus('authenticated');
    }
    return result;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await AuthApi.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, user, register, login, logout }),
    [status, user, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
