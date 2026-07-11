// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NoticeProvider from '../../src/components/NoticeProvider';
import ModerationPage from '../../src/pages/ModerationPage';
import type { ModerationRow } from '../../src/lib/moderationModel';

const useModerationMock = vi.fn();

vi.mock('../../src/hooks/useModeration', () => ({
  useModeration: () => useModerationMock(),
}));

afterEach(cleanup);

const row: ModerationRow = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08 20:14:02',
  activatedAt: '2026-07-09 08:01:10',
  deletedAt: null,
  url: '/posts/Ab3-_9xQ12',
};

const meta = { current_page: 1, last_page: 1, per_page: 100, total: 1 };

// ModerationActions (rendered per-row inside ModerationTable) now raises delete confirms
// through useNotice(), so a NoticeProvider ancestor is required to render the page at all.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/trashposts']}>
      <NoticeProvider>
        <ModerationPage />
      </NoticeProvider>
    </MemoryRouter>,
  );
}

describe('ModerationPage', () => {
  it('renders the table and pagination once loaded', () => {
    useModerationMock.mockReturnValue({
      rows: [row],
      meta,
      loading: false,
      empty: false,
      failed: false,
      retry: vi.fn(),
      applyRow: vi.fn(),
      removeRow: vi.fn(),
    });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('renders an explicit no-entries state for an empty corpus (FR-019)', () => {
    useModerationMock.mockReturnValue({
      rows: [],
      meta: null,
      loading: false,
      empty: true,
      failed: false,
      retry: vi.fn(),
      applyRow: vi.fn(),
      removeRow: vi.fn(),
    });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText(/no entries/i)).toBeTruthy();
  });

  it('shows a loading indicator while the page is in flight', () => {
    useModerationMock.mockReturnValue({
      rows: [],
      meta: null,
      loading: true,
      empty: false,
      failed: false,
      retry: vi.fn(),
      applyRow: vi.fn(),
      removeRow: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('renders an error state with retry on a failed fetch, never the empty message', () => {
    useModerationMock.mockReturnValue({
      rows: [],
      meta: null,
      loading: false,
      empty: false,
      failed: true,
      retry: vi.fn(),
      applyRow: vi.fn(),
      removeRow: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.queryByText('No entries to moderate.')).toBeNull();
  });
});
