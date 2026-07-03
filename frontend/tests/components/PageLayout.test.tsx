// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageLayout from '../../src/components/PageLayout';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';

afterEach(cleanup);

const anonymous: AuthContextValue = {
  status: 'anonymous',
  user: null,
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

function renderLayout() {
  render(
    <MemoryRouter>
      <AuthContext.Provider value={anonymous}>
        <PageLayout>
          <p>routed view</p>
        </PageLayout>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('PageLayout', () => {
  it('renders the routed view inside the main landmark', () => {
    renderLayout();

    const main = screen.getByRole('main');
    expect(main.textContent).toContain('routed view');
  });

  it('provides banner and navigation landmarks', () => {
    renderLayout();

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  });

  it('links the logo home with the site name as alt text', () => {
    renderLayout();

    const logo = screen.getByRole('img', { name: /online-trash home/i });
    expect(logo.closest('a')?.getAttribute('href')).toBe('/');
  });
});
