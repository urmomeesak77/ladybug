// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationRow from '../../../src/components/moderation/ModerationRow';
import NoticeProvider from '../../../src/components/NoticeProvider';
import type { ModerationRow as Row } from '../../../src/lib/moderationModel';

afterEach(cleanup);

const row: Row = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  title: 'A funny meme',
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08 20:14:02',
  activatedAt: '2026-07-09 08:01:10',
  deletedAt: null,
};

// ModerationActions (rendered inside ModerationRow) now raises delete confirms through
// useNotice(), so a NoticeProvider ancestor is required to render the row at all.
function renderRow(value: Row) {
  return render(
    <MemoryRouter initialEntries={['/admin/trashposts']}>
      <NoticeProvider>
        <table>
          <tbody>
            <ModerationRow row={value} onApply={() => {}} onRemove={() => {}} />
          </tbody>
        </table>
      </NoticeProvider>
    </MemoryRouter>,
  );
}

describe('ModerationRow', () => {
  it('renders all seven cells', () => {
    const { container } = renderRow(row);

    expect(container.querySelectorAll('td')).toHaveLength(7);
  });

  it('shows the post title', () => {
    renderRow(row);

    expect(screen.getByText('A funny meme')).toBeTruthy();
  });

  it('shows the uploader name in the user column (FR-012)', () => {
    renderRow(row);

    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('shows a placeholder when there is no uploader name', () => {
    renderRow({ ...row, username: null });

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows only the date part of the timestamps, with the full datetime as a tooltip', () => {
    renderRow(row);

    const created = screen.getByText('2026-07-08');
    const activated = screen.getByText('2026-07-09');
    expect(created.getAttribute('title')).toBe('2026-07-08 20:14:02');
    expect(activated.getAttribute('title')).toBe('2026-07-09 08:01:10');
  });

  it('puts no tooltip on an empty timestamp cell', () => {
    const { container } = renderRow(row);

    const deletedCell = container.querySelectorAll('td.moderation-time')[2];
    expect(deletedCell?.hasAttribute('title')).toBe(false);
  });

  it('cuts a long title to 20 characters, with the full title as the cell tooltip', () => {
    const { container } = renderRow({ ...row, title: 'Chewbacca Screams in terror' });

    expect(screen.getByRole('link', { name: 'Chewbacca Screams in…' })).toBeTruthy();
    const titleCell = container.querySelector('td.moderation-title');
    expect(titleCell?.getAttribute('title')).toBe('Chewbacca Screams in terror');
  });

  it('sets the title cell tooltip to the full title even when it was not cut', () => {
    const { container } = renderRow(row);

    const titleCell = container.querySelector('td.moderation-title');
    expect(titleCell?.getAttribute('title')).toBe('A funny meme');
  });

  it('leaves the deleted cell empty when the meme is not deleted', () => {
    const { container } = renderRow(row);

    // Cells: thumbnail, user, created, activated, deleted, actions — the deleted cell is empty.
    const deletedCell = container.querySelectorAll('td.moderation-time')[2];
    expect(deletedCell?.textContent).toBe('');
  });

  it('renders the title as a real link to the meme page (FR-018)', () => {
    renderRow(row);

    const link = screen.getByRole('link', { name: 'A funny meme' });
    expect(link.getAttribute('href')).toBe('/posts/Ab3-_9xQ12');
  });

  it('falls back to the hash as the link text when the meme has no title', () => {
    renderRow({ ...row, title: null });

    const link = screen.getByRole('link', { name: 'Ab3-_9xQ12' });
    expect(link.getAttribute('href')).toBe('/posts/Ab3-_9xQ12');
  });
});
