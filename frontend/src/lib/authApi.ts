import { apiBase } from './api';

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

// Laravel's validation error envelope: field name → list of messages.
export type FieldErrors = Record<string, string[]>;

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  | { ok: false; kind: 'network' };

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
};

export type LoginInput = { email: string; password: string };

type RawUser = {
  id: number;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
};

export function mapUser(raw: RawUser): AuthUser {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// Laravel sets the XSRF-TOKEN cookie (URL-encoded); we echo it back in the header so
// Sanctum's CSRF guard accepts unsafe requests. Guarded so the non-DOM test env is safe.
function xsrfToken(): string {
  const cookies = typeof document !== 'undefined' ? document.cookie : '';
  const match = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${apiBase()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': xsrfToken(),
    },
    body: JSON.stringify(body),
  });
}

// Shared mapping for register/login: a success status carries the user; 401 is the
// non-disclosing auth failure; 422 carries field errors; anything else is retryable.
async function interpretAuthResponse(response: Response, okStatus: number): Promise<AuthResult> {
  if (response.status === okStatus) {
    const body = (await response.json()) as { data?: RawUser };
    if (body.data) {
      return { ok: true, user: mapUser(body.data) };
    }
    return { ok: false, kind: 'network' };
  }
  if (response.status === 401) {
    return { ok: false, kind: 'auth' };
  }
  if (response.status === 422) {
    const body = (await response.json()) as { errors?: FieldErrors };
    return { ok: false, kind: 'validation', errors: body.errors ?? {} };
  }
  return { ok: false, kind: 'network' };
}

// Prime the CSRF cookie before the first unsafe request (Sanctum SPA flow).
export async function csrf(): Promise<void> {
  await fetch(`${apiBase()}/sanctum/csrf-cookie`, { credentials: 'include' });
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  try {
    const response = await postJson('/api/register', {
      name: input.name,
      email: input.email,
      password: input.password,
      password_confirmation: input.passwordConfirmation,
    });
    return await interpretAuthResponse(response, 201);
  } catch {
    return { ok: false, kind: 'network' };
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  try {
    const response = await postJson('/api/login', input);
    return await interpretAuthResponse(response, 200);
  } catch {
    return { ok: false, kind: 'network' };
  }
}

export async function logout(): Promise<{ ok: boolean }> {
  try {
    const response = await postJson('/api/logout', {});
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

// Rehydrate auth state from the backend. Anonymous is reported as null whether the API
// answers 200 {data:null} or 401, so the SPA never trusts a client-only flag (FR-014).
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${apiBase()}/api/user`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { data?: RawUser | null };
    return body.data ? mapUser(body.data) : null;
  } catch {
    return null;
  }
}
