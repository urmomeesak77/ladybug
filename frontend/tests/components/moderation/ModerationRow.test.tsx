// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationRow from '../../../src/components/moderation/ModerationRow';
import type { ModerationRow as Row } from '../../../src/lib/moderationModel';

afterEach(cleanup);

const row: Row = {
  hash: 'Ab3-_9xQ12',
  thumbnail: null,
  type: 'image',
  username: 'alice',
  createdAt: '2026-07-08T20:14:02.000000Z',
  activated: true,
  deleted: false,
  url: '/posts/Ab3-_9xQ12',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderRow(value: Row) {
  return render(
    <MemoryRouter initialEntries={['/admin/memes']}>
      <table>
        <tbody>
          <ModerationRow row={value} />
        </tbody>
      </table>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('ModerationRow', () => {
  it('renders all six cells', () => {
    const { container } = renderRow(row);

    expect(container.querySelectorAll('td')).toHaveLength(6);
  });

  it('shows the uploader name in the user column (FR-012)', () => {
    renderRow(row);

    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('shows a placeholder when there is no uploader name', () => {
    renderRow({ ...row, username: null });

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('exposes the created timestamp as a machine-readable time', () => {
    const { container } = renderRow(row);

    const time = container.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe('2026-07-08T20:14:02.000000Z');
  });

  it('navigates to the meme page when the row is clicked (FR-018)', () => {
    renderRow(row);

    fireEvent.click(screen.getByText('alice'));

    expect(screen.getByTestId('location').textContent).toBe('/posts/Ab3-_9xQ12');
  });
});
