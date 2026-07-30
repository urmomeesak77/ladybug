// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { useGoogleRefusal } from '../../src/hooks/useGoogleRefusal';

afterEach(cleanup);

function Probe({ pageError }: { pageError?: string }) {
  return <output data-testid="refusal">{useGoogleRefusal(pageError)}</output>;
}

function refusalAt(url: string, pageError?: string): string {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe pageError={pageError} />
    </MemoryRouter>,
  );
  return screen.getByTestId('refusal').textContent ?? '';
}

// Both auth pages read a refused Google round trip the same way (017, FR-007), so the
// reading lives in one place: two copies could drift into two different sentences for
// the same code, which is exactly what SC-006 forbids across the two front doors.
describe('useGoogleRefusal', () => {
  it('is silent on a page with no error parameter and no failure of its own', () => {
    expect(refusalAt('/login')).toBe('');
  });

  it('states the sentence for a code the backend handed back', () => {
    expect(refusalAt('/login?error=cancelled')).toBe('Google sign-in was cancelled.');
  });

  it('falls back to the retryable sentence for an unknown code', () => {
    expect(refusalAt('/login?error=teapot'))
      .toBe('Google could not be reached. Please try again, or use e-mail and password.');
  });

  it("lets the page's own failure win over the code still sitting in the URL", () => {
    // The submit the visitor just watched fail is a newer event than the round trip
    // that brought them here.
    expect(refusalAt('/login?error=cancelled', 'Email or password is incorrect.'))
      .toBe('Email or password is incorrect.');
  });
});
