// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
  url: '/posts/Ab3-_9xQ12',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

// ModerationActions (rendered inside ModerationRow) now raises delete confirms through
// useNotice(), so a NoticeProvider ancestor is required to render the row at all.
function renderRow(value: Row) {
  return render(
    <MemoryRouter initialEntries={['/admin/trashposts']}>
      <NoticeProvider>
        <table>
          <tbody>
            <ModerationRow row={value} onApply={() => {}} />
          </tbody>
        </table>
        <LocationProbe />
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

  it('cuts a long title to 20 characters with the full title as a tooltip', () => {
    renderRow({ ...row, title: 'Chewbacca Screams in terror' });

    const title = screen.getByText('Chewbacca Screams in…');
    expect(title.getAttribute('title')).toBe('Chewbacca Screams in terror');
  });

  it('puts no tooltip on a title that was not cut', () => {
    const { container } = renderRow(row);

    const titleCell = container.querySelector('td.moderation-title');
    expect(titleCell?.textContent).toBe('A funny meme');
    expect(titleCell?.hasAttribute('title')).toBe(false);
  });

  it('leaves the deleted cell empty when the meme is not deleted', () => {
    const { container } = renderRow(row);

    // Cells: thumbnail, user, created, activated, deleted, actions — the deleted cell is empty.
    const deletedCell = container.querySelectorAll('td.moderation-time')[2];
    expect(deletedCell?.textContent).toBe('');
  });

  it('navigates to the meme page when the row is clicked (FR-018)', () => {
    renderRow(row);

    fireEvent.click(screen.getByText('alice'));

    expect(screen.getByTestId('location').textContent).toBe('/posts/Ab3-_9xQ12');
  });
});
