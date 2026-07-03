// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, useAuth } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';

describe('useAuth', () => {
  it('throws when used outside an AuthProvider', () => {
    // Silence React's console noise for the expected render error.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useAuth())).toThrowError(/within an AuthProvider/);

    consoleError.mockRestore();
  });

  it('returns the context value inside a provider', () => {
    const value: AuthContextValue = {
      status: 'anonymous',
      user: null,
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current).toBe(value);
  });
});
