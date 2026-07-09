// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationTable from '../../../src/components/moderation/ModerationTable';
import type { ModerationRow } from '../../../src/lib/moderationModel';

afterEach(cleanup);

function makeRow(hash: string, username: string): ModerationRow {
  return {
    hash,
    thumbnail: null,
    type: 'image',
    username,
    createdAt: '2026-07-08T20:14:02.000000Z',
    activated: true,
    deleted: false,
    url: `/posts/${hash}`,
  };
}

function renderTable(rows: ModerationRow[]) {
  return render(
    <MemoryRouter>
      <ModerationTable rows={rows} />
    </MemoryRouter>,
  );
}

describe('ModerationTable', () => {
  it('has a caption and scoped column headers', () => {
    const { container } = renderTable([makeRow('aaaaaaaaaa', 'alice')]);

    expect(container.querySelector('caption')).toBeTruthy();
    const headers = container.querySelectorAll('th[scope="col"]');
    expect(headers).toHaveLength(6);
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
