// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../../src/lib/api';
import { GoogleAuth } from '../../src/lib/googleAuth';

afterEach(() => vi.restoreAllMocks());

describe('startUrl', () => {
  it('builds on the API origin, not a relative path', () => {
    // The SPA is served from :5173 and the API from :8000, so a relative URL would
    // navigate to the Vite dev server, which has no such route.
    vi.spyOn(Api, 'base').mockReturnValue('http://localhost:8000');

    expect(GoogleAuth.startUrl()).toBe('http://localhost:8000/api/auth/google/redirect');
  });

  it('stays same-origin when no API origin is configured', () => {
    vi.spyOn(Api, 'base').mockReturnValue('');

    expect(GoogleAuth.startUrl()).toBe('/api/auth/google/redirect');
  });

  it('omits the redirect parameter when there is nothing to return to', () => {
    vi.spyOn(Api, 'base').mockReturnValue('');

    // The route path itself ends in "redirect", so the assertion is on the parameter:
    // an absent intended path must leave the server-side default to take over.
    expect(GoogleAuth.startUrl()).not.toContain('?redirect=');
    expect(GoogleAuth.startUrl(undefined)).not.toContain('?redirect=');
    expect(GoogleAuth.startUrl('')).not.toContain('?redirect=');
  });

  it('percent-encodes the intended path', () => {
    vi.spyOn(Api, 'base').mockReturnValue('');

    expect(GoogleAuth.startUrl('/posts/abc')).toBe('/api/auth/google/redirect?redirect=%2Fposts%2Fabc');
  });

  it('encodes a path carrying a query of its own', () => {
    vi.spyOn(Api, 'base').mockReturnValue('');

    // Encoded whole, so the inner ? and & cannot split the outer query string.
    expect(GoogleAuth.startUrl('/posts?page=2&sort=new'))
      .toBe('/api/auth/google/redirect?redirect=%2Fposts%3Fpage%3D2%26sort%3Dnew');
  });
});

describe('errorMessage', () => {
  const messages: Array<[string, string]> = [
    ['cancelled', 'Google sign-in was cancelled.'],
    ['state', 'That sign-in attempt is no longer valid. Please try again.'],
    ['unverified_email', 'Google did not confirm an e-mail address for that account. Please use e-mail and password instead.'],
    ['already_linked', 'That account is already connected to a different Google account.'],
    ['disabled', 'This account is disabled.'],
    ['rate_limited', 'Too many sign-in attempts. Please wait a moment and try again.'],
    ['provider', 'Google could not be reached. Please try again, or use e-mail and password.'],
  ];

  it.each(messages)('maps %s to its sentence', (code, message) => {
    expect(GoogleAuth.errorMessage(code)).toBe(message);
  });

  it('shows the disabled sentence the password path already uses', () => {
    // SC-006: the same outcome at both front doors, worded identically.
    expect(GoogleAuth.errorMessage('disabled')).toBe('This account is disabled.');
  });

  it('falls back to the retryable message for an unknown code', () => {
    // Stops a future backend code rendering a blank alert.
    expect(GoogleAuth.errorMessage('something-new')).toBe(GoogleAuth.errorMessage('provider'));
  });

  it('never renders markup from a hand-crafted code', () => {
    // The value is a lookup key, never interpolated into the message (FR-007).
    expect(GoogleAuth.errorMessage('<script>alert(1)</script>')).toBe(GoogleAuth.errorMessage('provider'));
  });

  it('returns an empty message when no code is present', () => {
    // An ordinary visit to /login must not raise an alert out of nowhere.
    expect(GoogleAuth.errorMessage(null)).toBe('');
    expect(GoogleAuth.errorMessage(undefined)).toBe('');
  });
});

describe('start', () => {
  it('leaves the SPA for the backend start route', () => {
    vi.spyOn(Api, 'base').mockReturnValue('http://localhost:8000');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });

    GoogleAuth.start('/posts/abc');

    // A full-page navigation, not a router push: the flow continues at Google and
    // returns to a fresh document, so router state could not survive it anyway.
    expect(assign).toHaveBeenCalledWith('http://localhost:8000/api/auth/google/redirect?redirect=%2Fposts%2Fabc');
  });

  it('navigates with no redirect parameter when there is nothing to return to', () => {
    vi.spyOn(Api, 'base').mockReturnValue('');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });

    GoogleAuth.start();

    expect(assign).toHaveBeenCalledWith('/api/auth/google/redirect');
  });
});
