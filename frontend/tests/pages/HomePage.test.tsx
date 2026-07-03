// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from '../../src/pages/HomePage';
import { Api } from '../../src/lib/api';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHome(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  it('renders the labeled memes section with the newest feed', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome();

    expect(screen.getByRole('region', { name: 'Memes' })).toBeTruthy();
    expect(await screen.findByText(/no memes yet/i)).toBeTruthy();
    expect(Api.fetchFeed).toHaveBeenCalledWith({ limit: 10, start: undefined });
  });

  it('sets the document title', async () => {
    vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome();
    await screen.findByText(/no memes yet/i);

    expect(document.title).toBe('online-trash');
  });

  it('feeds the URL page cursor into the feed request', async () => {
    const fetchFeed = vi.spyOn(Api, 'fetchFeed').mockResolvedValue({ ok: true, posts: [] });

    renderHome('/?after=cursor0001');
    await screen.findByText(/no memes yet/i);

    expect(fetchFeed).toHaveBeenCalledWith({ limit: 10, start: 'cursor0001' });
  });
});
