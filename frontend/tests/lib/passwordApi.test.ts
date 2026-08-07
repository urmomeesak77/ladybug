import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordApi } from '../../src/lib/passwordApi';

type FetchArgs = [string, RequestInit];

// jsdom is not the default test environment, so provide the cookie the CSRF header is
// read from. The value is URL-encoded as Laravel sets it; passwordApi must decode it.
function withXsrfCookie(value = 'tok%2B123'): void {
  vi.stubGlobal('document', { cookie: `XSRF-TOKEN=${value}` });
}

function stubFetch(response: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestLink', () => {
  it('posts the address with credentials and the decoded XSRF header', async () => {
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({ message: 'ok' }) });

    await PasswordApi.requestLink('ada@example.com');

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/password\/forgot$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('tok+123');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'ada@example.com' });
  });

  it('reports success for any 200, whatever the server did behind it', async () => {
    // FR-004: the page must never have information to render anything but the
    // confirmation, so the client keeps none. A 200 is a 200.
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ message: 'If an account exists...' }) });

    expect(await PasswordApi.requestLink('ada@example.com')).toEqual({ ok: true });
  });

  it('maps a 422 to a validation result carrying the field errors', async () => {
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ message: 'invalid', errors: { email: ['The email field is required.'] } }),
    });

    const result = await PasswordApi.requestLink('');

    expect(result).toEqual({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email field is required.'] },
    });
  });

  it('maps a 422 with no error envelope to an empty field-error set', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 422, json: async () => ({ message: 'invalid' }) });

    expect(await PasswordApi.requestLink('')).toEqual({ ok: false, kind: 'validation', errors: {} });
  });

  it('maps a 429 to a rate-limited result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await PasswordApi.requestLink('ada@example.com')).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other status to a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await PasswordApi.requestLink('ada@example.com')).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await PasswordApi.requestLink('ada@example.com')).toEqual({ ok: false, kind: 'network' });
  });
});
