import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthApi } from '../../src/lib/authApi';
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

const DIGEST = '356a192b7913b04c54574d18c28d46e6395428ab';

describe('checkToken', () => {
  it('posts the digest and the token in the body, never in the URL', async () => {
    // The token is kept out of the query string for the same reason it rides in the
    // link's fragment: a URL reaches nginx's access log, a body does not (research D8).
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 204 });

    await PasswordApi.checkToken(DIGEST, 'a'.repeat(64));

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/password\/reset\/check$/);
    expect(url).not.toContain('token');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ hash: DIGEST, token: 'a'.repeat(64) });
  });

  it('maps a 204 to a live link', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 204 });

    expect(await PasswordApi.checkToken(DIGEST, 'tok')).toEqual({ ok: true });
  });

  it('maps a 403 to an invalid link', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 403, json: async () => ({ message: 'no longer valid' }) });

    expect(await PasswordApi.checkToken(DIGEST, 'tok')).toEqual({ ok: false, kind: 'invalid' });
  });

  it('maps a 429 to a rate-limited result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await PasswordApi.checkToken(DIGEST, 'tok')).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other status to a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await PasswordApi.checkToken(DIGEST, 'tok')).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await PasswordApi.checkToken(DIGEST, 'tok')).toEqual({ ok: false, kind: 'network' });
  });
});

describe('reset', () => {
  const input = {
    hash: DIGEST,
    token: 'a'.repeat(64),
    password: 'NewPassw0rd',
    passwordConfirmation: 'NewPassw0rd',
  };

  it('sends the confirmation under the name the server validates it by', async () => {
    // Laravel's `confirmed` rule looks for password_confirmation; sending the camelCase
    // field the form holds would make every reset a 422 nobody could correct.
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({ message: 'changed' }) });

    await PasswordApi.reset(input);

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/password\/reset$/);
    expect(JSON.parse(init.body as string)).toEqual({
      hash: DIGEST,
      token: 'a'.repeat(64),
      password: 'NewPassw0rd',
      password_confirmation: 'NewPassw0rd',
    });
  });

  it('maps a 200 to success', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ message: 'changed' }) });

    expect(await PasswordApi.reset(input)).toEqual({ ok: true });
  });

  it('maps a 422 to a validation result carrying the field errors', async () => {
    // The 422/403 split is the whole of US2 scenarios 3-4: a rejected password leaves the
    // link alive, so this result must NOT be the one that kills the page.
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ message: 'invalid', errors: { password: ['too short'] } }),
    });

    expect(await PasswordApi.reset(input)).toEqual({
      ok: false,
      kind: 'validation',
      errors: { password: ['too short'] },
    });
  });

  it('maps a 422 with no error envelope to an empty field-error set', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 422, json: async () => ({ message: 'invalid' }) });

    expect(await PasswordApi.reset(input)).toEqual({ ok: false, kind: 'validation', errors: {} });
  });

  it('maps a 403 to an invalid link', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 403, json: async () => ({ message: 'no longer valid' }) });

    expect(await PasswordApi.reset(input)).toEqual({ ok: false, kind: 'invalid' });
  });

  it('maps a 429 to a rate-limited result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await PasswordApi.reset(input)).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other status to a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await PasswordApi.reset(input)).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await PasswordApi.reset(input)).toEqual({ ok: false, kind: 'network' });
  });
});

// The account page's half (022, US3). Unlike the three above it is authenticated, so the
// session cookie the shared fetch shape already sends is what names the account.
describe('changePassword', () => {
  const raw = {
    hash: 'usr0000001',
    name: 'Ada',
    email: 'ada@example.com',
    email_verified_at: null,
    role: 'member' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    has_password: true,
    google_linked_at: null,
  };
  const input = {
    currentPassword: 'OldPassw0rd',
    password: 'NewPassw0rd',
    passwordConfirmation: 'NewPassw0rd',
  };

  it('puts the credential at its own address under the names the server validates', async () => {
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({ data: raw }) });

    await PasswordApi.changePassword(input);

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/user\/password$/);
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      current_password: 'OldPassw0rd',
      password: 'NewPassw0rd',
      password_confirmation: 'NewPassw0rd',
    });
  });

  it('omits the current password entirely when there is none to prove', async () => {
    // A Google-only account has no stored credential, so the server carries no rule for
    // the field; sending an empty string would be a value offered where none is asked for.
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({ data: raw }) });

    await PasswordApi.changePassword({ ...input, currentPassword: '' });

    const [, init] = mock.mock.calls[0] as FetchArgs;
    expect(JSON.parse(init.body as string)).toEqual({
      password: 'NewPassw0rd',
      password_confirmation: 'NewPassw0rd',
    });
  });

  it('maps a 200 to the refreshed profile in the shape the SPA speaks', async () => {
    // Mapped through AuthApi.mapUser rather than a private copy, so a newly gained
    // password reaches the page as `hasPassword` and the section can change shape.
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ data: raw }) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: true, user: AuthApi.mapUser(raw) });
  });

  it('maps a 200 with no profile in it to a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({}) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a 422 to a validation result carrying the field errors', async () => {
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ message: 'invalid', errors: { current_password: ['The password is incorrect.'] } }),
    });

    expect(await PasswordApi.changePassword(input)).toEqual({
      ok: false,
      kind: 'validation',
      errors: { current_password: ['The password is incorrect.'] },
    });
  });

  it('maps a 422 with no error envelope to an empty field-error set', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 422, json: async () => ({ message: 'invalid' }) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'validation', errors: {} });
  });

  it('maps a 401 to an auth result', async () => {
    // The session died between page load and submit; RequireAuth takes over on the next
    // render, so the page only has to say so.
    withXsrfCookie();
    stubFetch({ ok: false, status: 401, json: async () => ({ message: 'Unauthenticated.' }) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'auth' });
  });

  it('maps a 429 to a rate-limited result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other status to a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await PasswordApi.changePassword(input)).toEqual({ ok: false, kind: 'network' });
  });
});
