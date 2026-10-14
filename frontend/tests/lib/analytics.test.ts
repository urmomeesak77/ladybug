import { describe, expect, it, vi } from 'vitest';

import { Analytics } from '../../src/lib/analytics';

const ORIGIN = 'https://online-trash.example';
const DIGEST = '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12';

describe('Analytics.sanitisePath', () => {
  // The emailed recovery and verification links carry an unsalted sha1 of the address in
  // their path; GA must only ever see the route pattern.
  it('collapses a password-reset link to its route pattern', () => {
    expect(Analytics.sanitisePath(`/reset-password/${DIGEST}`)).toBe('/reset-password/:hash');
  });

  it('collapses an e-mail verification link to its route pattern', () => {
    expect(Analytics.sanitisePath(`/verify-email/${DIGEST}`)).toBe('/verify-email/:hash');
  });

  it('collapses a trailing-slash variant as well', () => {
    expect(Analytics.sanitisePath(`/reset-password/${DIGEST}/`)).toBe('/reset-password/:hash');
  });

  it('leaves every other path as it is', () => {
    expect(Analytics.sanitisePath('/')).toBe('/');
    expect(Analytics.sanitisePath('/posts/abc1234567')).toBe('/posts/abc1234567');
    expect(Analytics.sanitisePath('/verify-email')).toBe('/verify-email');
    expect(Analytics.sanitisePath('/forgot-password')).toBe('/forgot-password');
  });
});

describe('Analytics.pageLocation', () => {
  it('is the origin plus the sanitised path — never a query or fragment', () => {
    expect(Analytics.pageLocation(ORIGIN, `/reset-password/${DIGEST}`)).toBe(`${ORIGIN}/reset-password/:hash`);
  });
});

describe('Analytics.sanitiseReferrer', () => {
  it('sanitises a same-origin referrer the same way as a page location', () => {
    expect(Analytics.sanitiseReferrer(`${ORIGIN}/verify-email/${DIGEST}?expires=1&signature=x`, ORIGIN))
      .toBe(`${ORIGIN}/verify-email/:hash`);
  });

  it('reduces a foreign referrer to its origin', () => {
    expect(Analytics.sanitiseReferrer('https://mail.example/inbox/123?q=secret#msg', ORIGIN))
      .toBe('https://mail.example/');
  });

  it('is empty for no or unparseable referrer', () => {
    expect(Analytics.sanitiseReferrer('', ORIGIN)).toBe('');
    expect(Analytics.sanitiseReferrer('not a url', ORIGIN)).toBe('');
  });
});

describe('Analytics.trackPageView', () => {
  it('sets the sanitised location for later events and sends one page_view', () => {
    const gtag = vi.fn();

    Analytics.trackPageView({ gtag }, {
      location: `${ORIGIN}/reset-password/:hash`,
      path: '/reset-password/:hash',
      referrer: '',
      title: 'Reset password',
    });

    const params = {
      page_location: `${ORIGIN}/reset-password/:hash`,
      page_path: '/reset-password/:hash',
      page_referrer: '',
      page_title: 'Reset password',
    };
    expect(gtag.mock.calls).toEqual([['set', params], ['event', 'page_view', params]]);
  });

  // Blocked by an extension, or a build without the tag: analytics is never load-bearing.
  it('does nothing when the tag is absent', () => {
    expect(() => Analytics.trackPageView({}, { location: ORIGIN, path: '/', referrer: '', title: '' })).not.toThrow();
  });
});
