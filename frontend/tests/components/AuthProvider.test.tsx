// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthProvider from '../../src/components/AuthProvider';
import { useAuth } from '../../src/hooks/useAuth';
import { AuthApi } from '../../src/lib/authApi';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ada: AuthUser = {
  hash: 'usr0000001',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerifiedAt: null,
  role: 'member',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Exposes the context so the provider's state transitions are observable from the DOM.
function Probe() {
  const { status, user, role, login, register, logout, refresh } = useAuth();
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="name">{user?.name ?? ''}</output>
      <output data-testid="verified">{user?.emailVerifiedAt ?? ''}</output>
      <output data-testid="role">{role}</output>
      <button onClick={() => void login({ email: 'ada@example.com', password: 'pw' })}>do-login</button>
      <button
        onClick={() => void register({
          name: 'Ada',
          email: 'ada@example.com',
          password: 'pw',
          passwordConfirmation: 'pw',
        })}
      >
        do-register
      </button>
      <button onClick={() => void logout()}>do-logout</button>
      <button onClick={() => void refresh()}>do-refresh</button>
    </div>
  );
}

function renderProvider(currentUser: AuthUser | null) {
  vi.spyOn(AuthApi, 'fetchCurrentUser').mockResolvedValue(currentUser);
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

async function expectStatus(expected: string) {
  const status = await screen.findByTestId('status');
  await screen.findByText(expected, { selector: 'output' });
  expect(status.textContent).toBe(expected);
}

describe('AuthProvider', () => {
  it('derives authenticated state from the backend session probe', async () => {
    renderProvider(ada);

    await expectStatus('authenticated');
    expect(screen.getByTestId('name').textContent).toBe('Ada');
  });

  it('derives anonymous state when the probe reports no session', async () => {
    renderProvider(null);

    await expectStatus('anonymous');
  });

  it('exposes the effective role guest when the viewer is anonymous', async () => {
    renderProvider(null);

    await expectStatus('anonymous');
    expect(screen.getByTestId('role').textContent).toBe('guest');
  });

  it('exposes guest while the initial session probe is still in flight', () => {
    // The probe never resolves here, so status stays 'unknown'; the effective role
    // is guest until a user materialises, exactly like status.
    vi.spyOn(AuthApi, 'fetchCurrentUser').mockReturnValue(new Promise(() => {}));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('unknown');
    expect(screen.getByTestId('role').textContent).toBe('guest');
  });

  it.each(['member', 'admin', 'superuser'] as const)(
    'exposes the stored role %s when the viewer is authenticated',
    async (role) => {
      renderProvider({ ...ada, role });

      await expectStatus('authenticated');
      expect(screen.getByTestId('role').textContent).toBe(role);
    },
  );

  it('flips to authenticated after a successful login', async () => {
    renderProvider(null);
    vi.spyOn(AuthApi, 'login').mockResolvedValue({ ok: true, user: ada });
    await expectStatus('anonymous');

    fireEvent.click(screen.getByText('do-login'));

    await expectStatus('authenticated');
    expect(screen.getByTestId('name').textContent).toBe('Ada');
  });

  it('stays anonymous when login fails', async () => {
    renderProvider(null);
    const login = vi.spyOn(AuthApi, 'login').mockResolvedValue({ ok: false, kind: 'auth' });
    await expectStatus('anonymous');

    fireEvent.click(screen.getByText('do-login'));

    // Wait for the failed call to settle before asserting the state did not flip.
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    await expectStatus('anonymous');
  });

  it('flips to authenticated after a successful registration', async () => {
    renderProvider(null);
    vi.spyOn(AuthApi, 'register').mockResolvedValue({ ok: true, user: ada });
    await expectStatus('anonymous');

    fireEvent.click(screen.getByText('do-register'));

    await expectStatus('authenticated');
  });

  it('refresh() re-probes the session and updates emailVerifiedAt', async () => {
    const probe = vi.spyOn(AuthApi, 'fetchCurrentUser')
      .mockResolvedValueOnce(ada)
      .mockResolvedValueOnce({ ...ada, emailVerifiedAt: '2026-07-07T10:00:00Z' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await expectStatus('authenticated');
    expect(screen.getByTestId('verified').textContent).toBe('');

    fireEvent.click(screen.getByText('do-refresh'));

    await waitFor(() => expect(screen.getByTestId('verified').textContent).toBe('2026-07-07T10:00:00Z'));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('refresh() drops to anonymous when the session has expired', async () => {
    vi.spyOn(AuthApi, 'fetchCurrentUser')
      .mockResolvedValueOnce(ada)
      .mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await expectStatus('authenticated');

    fireEvent.click(screen.getByText('do-refresh'));

    await expectStatus('anonymous');
    expect(screen.getByTestId('name').textContent).toBe('');
  });

  it('clears the user on logout', async () => {
    renderProvider(ada);
    vi.spyOn(AuthApi, 'logout').mockResolvedValue({ ok: true });
    await expectStatus('authenticated');

    fireEvent.click(screen.getByText('do-logout'));

    await expectStatus('anonymous');
    expect(screen.getByTestId('name').textContent).toBe('');
  });
});
