// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AuthAlt from '../../src/components/AuthAlt';
import { GoogleAuth } from '../../src/lib/googleAuth';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAlt(redirectTo?: string) {
  const start = vi.spyOn(GoogleAuth, 'start').mockImplementation(() => undefined);
  render(<AuthAlt redirectTo={redirectTo} />);
  return start;
}

// The alternative sign-in door shared by both auth pages (017, US6). One component so the
// two pages cannot drift apart in how they separate the methods or what they label them.
describe('AuthAlt', () => {
  it('separates the methods with the word "or"', () => {
    renderAlt();

    // FR-026: the separation is a real, visible, screen-reader-reachable word — the
    // hairlines around it are CSS decoration and carry nothing.
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('offers the Google door with a name that states the action', () => {
    renderAlt();

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });

  it('forwards a blocked destination to the flow', () => {
    const start = renderAlt('/posts/abc');

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(start).toHaveBeenCalledWith('/posts/abc');
  });

  it('starts with no destination when there is nothing to return to', () => {
    const start = renderAlt();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(start).toHaveBeenCalledWith(undefined);
  });
});
