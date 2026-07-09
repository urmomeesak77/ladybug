// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08T20:14:02.000000Z',
  activated: true,
  deleted: false,
  url: '/posts/Ab3-_9xQ12',
};

const meta = { current_page: 1, last_page: 1, per_page: 100, total: 1 };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/memes']}>
      <ModerationPage />
    </MemoryRouter>,
  );
}

describe('ModerationPage', () => {
  it('renders the table and pagination once loaded', () => {
    useModerationMock.mockReturnValue({ rows: [row], meta, loading: false, empty: false });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('renders an explicit no-entries state for an empty corpus (FR-019)', () => {
    useModerationMock.mockReturnValue({ rows: [], meta: null, loading: false, empty: true });

    const { container } = renderPage();

    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText(/no entries/i)).toBeTruthy();
  });

  it('shows a loading indicator while the page is in flight', () => {
    useModerationMock.mockReturnValue({ rows: [], meta: null, loading: true, empty: false });

    renderPage();

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });
});
