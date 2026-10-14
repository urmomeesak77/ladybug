// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePageViews } from '../../src/hooks/usePageViews';

const DIGEST = '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12';
let gtag: ReturnType<typeof vi.fn>;
// Hands the router's navigate out to the test body; set from an effect, not during render.
const router: { navigate: NavigateFunction | null } = { navigate: null };

function Harness() {
  usePageViews();
  const navigate = useNavigate();
  useEffect(() => {
    router.navigate = navigate;
  }, [navigate]);
  return null;
}

function navigate(to: string): void {
  void router.navigate?.(to);
}

function pageViews(): Record<string, string>[] {
  return gtag.mock.calls.filter(([command]) => command === 'event').map(([, , params]) => params);
}

beforeEach(() => {
  gtag = vi.fn();
  vi.stubGlobal('gtag', gtag);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePageViews', () => {
  it('sends the landing page view with the emailed digest collapsed out of it', () => {
    render(
      <MemoryRouter initialEntries={[`/reset-password/${DIGEST}?x=1#token=secret`]}>
        <Harness />
      </MemoryRouter>,
    );

    expect(pageViews()).toHaveLength(1);
    const [view] = pageViews();
    expect(view.page_path).toBe('/reset-password/:hash');
    expect(view.page_location).toBe(`${window.location.origin}/reset-password/:hash`);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain(DIGEST);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('secret');
  });

  it('sends a page view per route change, referring back to the previous page', () => {
    render(
      <MemoryRouter initialEntries={[`/verify-email/${DIGEST}`]}>
        <Harness />
      </MemoryRouter>,
    );

    act(() => navigate('/posts/abc1234567'));

    const views = pageViews();
    expect(views).toHaveLength(2);
    expect(views[1].page_path).toBe('/posts/abc1234567');
    expect(views[1].page_referrer).toBe(`${window.location.origin}/verify-email/:hash`);
  });

  // The feed's "Load more" page break only changes the query; that is the same page.
  it('does not count a query-only change as a new page view', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>,
    );

    act(() => navigate('/?after=abc1234567'));

    expect(pageViews()).toHaveLength(1);
  });

  // main.tsx renders under StrictMode, which runs every effect twice in development.
  it('counts a page once even when its effect runs twice', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/']}>
          <Harness />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(pageViews()).toHaveLength(1);
  });
});
