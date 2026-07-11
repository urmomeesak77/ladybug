// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Csrf } from '../../src/lib/csrf';

describe('Csrf.ensure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('returns the existing token without a network call', async () => {
    document.cookie = 'XSRF-TOKEN=already-set';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await Csrf.ensure()).toBe('already-set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('primes the sanctum cookie endpoint when no token exists', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      document.cookie = 'XSRF-TOKEN=fresh-token';
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await Csrf.ensure()).toBe('fresh-token');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sanctum/csrf-cookie');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });
});
