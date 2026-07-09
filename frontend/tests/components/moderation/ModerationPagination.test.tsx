// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationPagination from '../../../src/components/moderation/ModerationPagination';

afterEach(cleanup);

function renderPagination(currentPage: number, lastPage: number) {
  return render(
    <MemoryRouter initialEntries={['/admin/trashposts']}>
      <ModerationPagination meta={{ current_page: currentPage, last_page: lastPage, per_page: 100, total: 250 }} />
    </MemoryRouter>,
  );
}

describe('ModerationPagination', () => {
  it('renders one numbered link per page, each carrying ?page=N', () => {
    renderPagination(1, 3);

    for (const page of [1, 2, 3]) {
      const link = screen.getByRole('link', { name: String(page) });
      expect(link.getAttribute('href')).toContain(`page=${page}`);
    }
  });

  it('marks the current page as the current link', () => {
    renderPagination(2, 3);

    expect(screen.getByRole('link', { name: '2' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: '1' }).getAttribute('aria-current')).toBeNull();
  });

  it('renders nothing extra when there is only a single page', () => {
    renderPagination(1, 1);

    expect(screen.getByRole('link', { name: '1' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '2' })).toBeNull();
  });
});
