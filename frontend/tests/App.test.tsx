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
});
