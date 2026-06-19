import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  csrf,
  fetchCurrentUser,
  login,
  logout,
  mapUser,
  register,
} from '../../src/lib/authApi';

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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapUser', () => {
  it('maps the snake_case API payload to a camelCase AuthUser', () => {
    expect(mapUser(rawUser)).toEqual({
      id: 7,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });
});

describe('csrf', () => {
  it('GETs the csrf-cookie endpoint with credentials included', async () => {
    const mock = stubFetch({ ok: true, status: 204 });

    await csrf();

    const [url, init] = mock.mock.calls[0] as FetchArgs;
    expect(url).toMatch(/\/sanctum\/csrf-cookie$/);
    expect(init.credentials).toBe('include');
  });
});

describe('register', () => {
  it('sends credentials, the decoded XSRF header, and a snake_case body', async () => {
    withXsrfCookie();
    const mock = stubFetch({ ok: true, status: 201, json: async () => ({ data: rawUser }) });

    await register({ name: 'Ada', email: 'ada@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

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

    const result = await register({ name: 'Ada', email: 'ada@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

    expect(result).toEqual({ ok: true, user: mapUser(rawUser) });
  });

  it('maps a 422 to a validation result carrying the field errors', async () => {
    withXsrfCookie();
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ message: 'invalid', errors: { email: ['The email has already been taken.'] } }),
    });

    const result = await register({ name: 'Ada', email: 'taken@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

    expect(result).toEqual({ ok: false, kind: 'validation', errors: { email: ['The email has already been taken.'] } });
  });

  it('maps any other failure to a network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 500, json: async () => ({}) });

    const result = await register({ name: 'Ada', email: 'ada@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const result = await register({ name: 'Ada', email: 'ada@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('treats a success status without a user body as a retryable network result', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 201, json: async () => ({}) });

    const result = await register({ name: 'Ada', email: 'ada@example.com', password: 'Password1', passwordConfirmation: 'Password1' });

    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});

describe('login', () => {
  it('returns the user on 200', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ data: rawUser }) });

    const result = await login({ email: 'ada@example.com', password: 'Password1' });

    expect(result).toEqual({ ok: true, user: mapUser(rawUser) });
  });

  it('maps a 401 to a (non-disclosing) auth result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 401, json: async () => ({ message: 'These credentials do not match our records.' }) });

    const result = await login({ email: 'ada@example.com', password: 'wrong' });

    expect(result).toEqual({ ok: false, kind: 'auth' });
  });

  it('maps a 422 to a validation result', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 422, json: async () => ({ errors: { email: ['The email field is required.'] } }) });

    const result = await login({ email: '', password: 'x' });

    expect(result).toEqual({ ok: false, kind: 'validation', errors: { email: ['The email field is required.'] } });
  });

  it('maps a thrown fetch to a network result', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await login({ email: 'ada@example.com', password: 'x' })).toEqual({ ok: false, kind: 'network' });
  });
});

describe('logout', () => {
  it('reports ok on a 200', async () => {
    withXsrfCookie();
    stubFetch({ ok: true, status: 200, json: async () => ({ message: 'Logged out.' }) });

    expect(await logout()).toEqual({ ok: true });
  });

  it('reports not-ok on a failure', async () => {
    withXsrfCookie();
    stubFetch({ ok: false, status: 401, json: async () => ({}) });

    expect(await logout()).toEqual({ ok: false });
  });

  it('reports not-ok when the request throws', async () => {
    withXsrfCookie();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await logout()).toEqual({ ok: false });
  });
});

describe('fetchCurrentUser', () => {
  it('returns the user when the session is valid', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ data: rawUser }) });

    expect(await fetchCurrentUser()).toEqual(mapUser(rawUser));
  });

  it('returns null when the body reports no authenticated user', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ data: null }) });

    expect(await fetchCurrentUser()).toBeNull();
  });

  it('returns null on a 401', async () => {
    stubFetch({ ok: false, status: 401, json: async () => ({}) });

    expect(await fetchCurrentUser()).toBeNull();
  });

  it('returns null on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    expect(await fetchCurrentUser()).toBeNull();
  });
});
