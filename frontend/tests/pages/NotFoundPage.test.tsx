// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import NotFoundPage from '../../src/pages/NotFoundPage';

afterEach(cleanup);

describe('NotFoundPage', () => {
  it('labels the page and offers a way back to the feed', () => {
    render(<NotFoundPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Back to the feed' });
    expect(back.getAttribute('href')).toBe('/');
  });
});
