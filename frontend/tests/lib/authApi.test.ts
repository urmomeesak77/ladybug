import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthApi } from '../../src/lib/authApi';

type FetchArgs = [string, RequestInit];

// jsdom is not the default test environment, so provide the cookie the CSRF header
// is read from. The value is URL-encoded as Laravel sets it; authApi must decode it.
function withXsrfCookie(value = 'tok%2B123'): void {
  vi.stubGlobal('document', { cookie: `XSRF-TOKEN=${value}` });
}

function stubFetch(response: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const rawUser = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  email_verified_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const registerInput = {
  name: 'Ada',
  email: 'ada@example.com',
  password: 'Password1',
  passwordConfirmation: 'Password1',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapUser', () => {
  it('maps the snake_case API payload to a camelCase AuthUser', () => {
    expect(AuthApi.mapUser(rawUser)).toEqual({
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerifiedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('carries a verified email timestamp through as emailVerifiedAt', () => {
    const verified = { ...rawUser, email_verified_at: '2026-07-01T12:00:00Z' };

    expect(AuthApi.mapUser(verified).emailVerifiedAt).toBe('2026-07-01T12:00:00Z');
  });
});

describe('csrf', () => {
  it('GETs the csrf-cookie endpoint with credentials included', async () => {
    const mock = stubFetch({ ok: true, status: 204 });

    await AuthApi.csrf();

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/sanctum\/csrf-cookie$/);
    expect(init.credentials).toBe('include');
  });
});

describe('register', () => {
  it('sends credentials, the decoded XSRF header, and a snake_case body', async () => {
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 201, json: async () => ({ data: rawUser }) });

    await AuthApi.register(registerInput);

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/register$/);
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('tok+123');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.password_confirmation).toBe('Password1');
    expect(body.name).toBe('Ada');
  });

  it('returns the user on 201', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 201, json: async () => ({ data: rawUser }) });

    const result = await AuthApi.register(registerInput);

    expect(result).toEqual({ ok: true, user: AuthApi.mapUser(rawUser) });
  });

  it('maps a 422 to a validation result carrying the field errors', async () => {
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ message: 'invalid', errors: { email: ['The email has already been taken.'] } }),
    });

    const result = await AuthApi.register({ ...registerInput, email: 'taken@example.com' });

    expect(result).toEqual({
      ok: false,
      kind: 'validation',
      errors: { email: ['The email has already been taken.'] },
    });
  });

  it('maps any other failure to a network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    const result = await AuthApi.register(registerInput);

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const result = await AuthApi.register(registerInput);

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('treats a success status without a user body as a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 201, json: async () => ({}) });

    const result = await AuthApi.register(registerInput);

    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});

describe('login', () => {
  it('returns the user on 200', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ data: rawUser }) });

    const result = await AuthApi.login({ email: 'ada@example.com', password: 'Password1' });

    expect(result).toEqual({ ok: true, user: AuthApi.mapUser(rawUser) });
  });

  it('maps a 401 to a (non-disclosing) auth result', async () => {
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 401,
      json: async () => ({ message: 'These credentials do not match our records.' }),
    });

    const result = await AuthApi.login({ email: 'ada@example.com', password: 'wrong' });

    expect(result).toEqual({ ok: false, kind: 'auth' });
  });

  it('maps a 422 to a validation result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 422, json: async () => ({ errors: { email: ['The email field is required.'] } }) });

    const result = await AuthApi.login({ email: '', password: 'x' });

    expect(result).toEqual({ ok: false, kind: 'validation', errors: { email: ['The email field is required.'] } });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await AuthApi.login({ email: 'ada@example.com', password: 'x' })).toEqual({ ok: false, kind: 'network' });
  });
});

describe('logout', () => {
  it('reports ok on a 200', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ message: 'Logged out.' }) });

    expect(await AuthApi.logout()).toEqual({ ok: true });
  });

  it('reports not-ok on a failure', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 401, json: async () => ({}) });

    expect(await AuthApi.logout()).toEqual({ ok: false });
  });

  it('reports not-ok when the request throws', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await AuthApi.logout()).toEqual({ ok: false });
  });
});

describe('verifyEmail', () => {
  const input = { hash: 'abc123', expires: '1767225600', signature: 'deadbeef' };

  it('GETs the signed verify URL with credentials included', async () => {
    const mock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ data: rawUser, meta: { already_verified: false } }),
    });

    await AuthApi.verifyEmail(input);

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/email\/verify\/abc123\?expires=1767225600&signature=deadbeef$/);
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('reports a fresh verification on 200 with already_verified false', async () => {
    const verified = { ...rawUser, email_verified_at: '2026-07-07T10:00:00Z' };
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ data: verified, meta: { already_verified: false } }),
    });

    const result = await AuthApi.verifyEmail(input);

    expect(result).toEqual({ ok: true, user: AuthApi.mapUser(verified), alreadyVerified: false });
  });

  it('reports an idempotent re-use on 200 with already_verified true', async () => {
    const verified = { ...rawUser, email_verified_at: '2026-07-01T12:00:00Z' };
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ data: verified, meta: { already_verified: true } }),
    });

    const result = await AuthApi.verifyEmail(input);

    expect(result).toEqual({ ok: true, user: AuthApi.mapUser(verified), alreadyVerified: true });
  });

  it('maps a 403 (tampered/expired/mismatched link) to an invalid result', async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ message: 'Invalid signature.' }) });

    expect(await AuthApi.verifyEmail(input)).toEqual({ ok: false, kind: 'invalid' });
  });

  it('maps a 429 to a rate-limited result', async () => {
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await AuthApi.verifyEmail(input)).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other failure to a network result', async () => {
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await AuthApi.verifyEmail(input)).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await AuthApi.verifyEmail(input)).toEqual({ ok: false, kind: 'network' });
  });
});

describe('resendVerification', () => {
  it('POSTs through the CSRF-aware path with credentials included', async () => {
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({ message: 'Verification link sent.' }) });

    const result = await AuthApi.resendVerification();

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/api\/email\/verification-notification$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('tok+123');
    expect(result).toEqual({ ok: true });
  });

  it('maps a 409 to an already-verified result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 409, json: async () => ({ message: 'Email already verified.' }) });

    expect(await AuthApi.resendVerification()).toEqual({ ok: false, kind: 'already-verified' });
  });

  it('maps a 429 to a rate-limited result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 429, json: async () => ({ message: 'Too Many Attempts.' }) });

    expect(await AuthApi.resendVerification()).toEqual({ ok: false, kind: 'rate-limited' });
  });

  it('maps any other failure to a network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    expect(await AuthApi.resendVerification()).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await AuthApi.resendVerification()).toEqual({ ok: false, kind: 'network' });
  });
});

describe('fetchCurrentUser', () => {
  it('returns the user when the session is valid', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ data: rawUser }) });

    expect(await AuthApi.fetchCurrentUser()).toEqual(AuthApi.mapUser(rawUser));
  });

  it('returns null when the body reports no authenticated user', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ data: null }) });

    expect(await AuthApi.fetchCurrentUser()).toBeNull();
  });

  it('returns null on a 401', async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({}) });

    expect(await AuthApi.fetchCurrentUser()).toBeNull();
  });

  it('returns null on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await AuthApi.fetchCurrentUser()).toBeNull();
  });
});
