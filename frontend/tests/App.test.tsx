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
