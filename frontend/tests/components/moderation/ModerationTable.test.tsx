// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationTable from '../../../src/components/moderation/ModerationTable';
import NoticeProvider from '../../../src/components/NoticeProvider';
import type { ModerationRow } from '../../../src/lib/moderationModel';

afterEach(cleanup);

function makeRow(hash: string, username: string): ModerationRow {
  return {
    hash,
    thumbnail: null,
    title: 'A funny meme',
    type: 'image',
    username,
    rating: 17,
    createdAt: '2026-07-08 20:14:02',
    activatedAt: '2026-07-09 08:01:10',
    deletedAt: null,
  };
}

// ModerationActions (rendered per-row inside ModerationTable) now raises delete confirms
// through useNotice(), so a NoticeProvider ancestor is required to render the table at all.
function renderTable(rows: ModerationRow[]) {
  return render(
    <MemoryRouter>
      <NoticeProvider>
        <ModerationTable rows={rows} onApply={() => {}} onRemove={() => {}} />
      </NoticeProvider>
    </MemoryRouter>,
  );
}

describe('ModerationTable', () => {
  it('has a caption and scoped column headers', () => {
    const { container } = renderTable([makeRow('aaaaaaaaaa', 'alice')]);

    expect(container.querySelector('caption')).toBeTruthy();
    const headers = container.querySelectorAll('th[scope="col"]');
    expect(headers).toHaveLength(8);
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeTruthy();
  });

  it('renders one row per meme', () => {
    renderTable([makeRow('aaaaaaaaaa', 'alice'), makeRow('bbbbbbbbbb', 'bob')]);

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('keeps the wide table in a horizontal-scroll container so the page never overflows', () => {
    const { container } = renderTable([makeRow('aaaaaaaaaa', 'alice')]);

    expect(container.querySelector('.moderation-table__scroll')).toBeTruthy();
  });
});

describe('ModerationTable rating column', () => {
  it('renders a rating header', () => {
    renderTable([makeRow('aaaaaaaaaa', 'alice')]);

    expect(screen.getByRole('columnheader', { name: 'Rating' })).toBeTruthy();
  });
});
