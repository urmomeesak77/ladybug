// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { Api } from '../src/lib/api';
import { AuthApi } from '../src/lib/authApi';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom has no matchMedia; the theme hook only needs a static light-scheme answer.
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  sessionStorage.clear();
  vi.spyOn(AuthApi, 'fetchCurrentUser').mockResolvedValue(null);
  vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('mounts the home feed inside the shared layout at /', async () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(await screen.findByText(/no memes yet/i)).toBeTruthy();
  });

  it('routes unknown paths to the not-found page', async () => {
    window.history.pushState({}, '', '/no/such/page');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('redirects /account to /login for anonymous visitors', async () => {
    window.history.pushState({}, '', '/account');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('redirects a member away from the admin user console', async () => {
    // /admin/users is wrapped in RequireRole role="admin": an authenticated member is
    // under-ranked, so the gate sends them Home rather than rendering the console.
    vi.spyOn(AuthApi, 'fetchCurrentUser').mockResolvedValue({
      hash: 'usr0000001',
      name: 'Mel',
      email: 'mel@example.com',
      emailVerifiedAt: '2026-01-01T00:00:00Z',
      role: 'member',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    window.history.pushState({}, '', '/admin/users');

    render(<App />);

    expect(await screen.findByText(/no memes yet/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Users' })).toBeNull();
  });
});

/**
 * Both recovery routes are deliberately UNGUARDED, and nothing but this enforces it. The
 * account a recovery link names is the LINK's, never the signed-in one (research D11), so a
 * signed-in visitor must be able to open someone else's link and change THAT account. Wrapping
 * either route in RequireAnon would bounce them to `/` and silently break the behaviour the
 * server-side test proves — with the rest of the suite still green.
 */
describe('App, the recovery routes', () => {
  const DIGEST = '356a192b7913b04c54574d18c28d46e6395428ab';

  const ada = {
    hash: 'usr0000001',
    name: 'Ada',
    email: 'ada@example.com',
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    role: 'member' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    hasPassword: true,
    googleLinkedAt: null,
  };

  it('mounts the request page at /forgot-password', async () => {
    window.history.pushState({}, '', '/forgot-password');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeTruthy();
  });

  it('mounts the reset page at /reset-password/:hash', async () => {
    window.history.pushState({}, '', `/reset-password/${DIGEST}#token=${'a'.repeat(64)}`);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeTruthy();
  });

  it('lets a SIGNED-IN visitor open a recovery link rather than bouncing them home', async () => {
    vi.spyOn(AuthApi, 'fetchCurrentUser').mockResolvedValue(ada);
    window.history.pushState({}, '', `/reset-password/${DIGEST}#token=${'a'.repeat(64)}`);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeTruthy();
  });

  it('lets a SIGNED-IN visitor reach the request page too', async () => {
    vi.spyOn(AuthApi, 'fetchCurrentUser').mockResolvedValue(ada);
    window.history.pushState({}, '', '/forgot-password');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeTruthy();
  });
});
