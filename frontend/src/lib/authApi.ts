import { Api } from './api';
import { Csrf } from './csrf';
import type { RoleName } from './role';

export type AuthUser = {
  hash: string;
  name: string;
  email: string;
  // null until the account's email is verified (008).
  emailVerifiedAt: string | null;
  // The account's stored role — always assignable (member/admin/superuser), never guest (009).
  role: RoleName;
  createdAt: string;
  updatedAt: string;
};

// Laravel's validation error envelope: field name → list of messages.
export type FieldErrors = Record<string, string[]>;

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  // Correct credentials but the account is disabled (login only, 403): distinct from `auth`
  // so the form can show the disabled message rather than "email or password is incorrect".
  | { ok: false; kind: 'disabled' }
  | { ok: false; kind: 'network' };

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
};

export type LoginInput = { email: string; password: string };

// The components of a verification link, forwarded verbatim to the API (008).
export type VerifyEmailInput = { hash: string; expires: string; signature: string };

export type VerifyEmailResult =
  | { ok: true; user: AuthUser; alreadyVerified: boolean }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'rate-limited' }
  | { ok: false; kind: 'network' };

export type ResendResult =
  | { ok: true }
  | { ok: false; kind: 'already-verified' }
  | { ok: false; kind: 'rate-limited' }
  | { ok: false; kind: 'network' };

type RawUser = {
  hash: string;
  name: string;
  email: string;
  email_verified_at: string | null;
  role: RoleName;
  created_at: string;
  updated_at: string;
};

// Sanctum SPA cookie-session auth client (007): register/login/logout plus session probe.
export class AuthApi {
  static mapUser(raw: RawUser): AuthUser {
    return {
      hash: raw.hash,
      name: raw.name,
      email: raw.email,
      emailVerifiedAt: raw.email_verified_at,
      role: raw.role,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
  }

  static async register(input: RegisterInput): Promise<AuthResult> {
    try {
      const response = await AuthApi.postJson('/api/register', {
        name: input.name,
        email: input.email,
        password: input.password,
        password_confirmation: input.passwordConfirmation,
      });
      return await AuthApi.interpret(response, 201);
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  static async login(input: LoginInput): Promise<AuthResult> {
    try {
      const response = await AuthApi.postJson('/api/login', input);
      return await AuthApi.interpret(response, 200);
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  static async logout(): Promise<{ ok: boolean }> {
    try {
      const response = await AuthApi.postJson('/api/logout', {});
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }

  // Fulfill a verification link (008): the signature was computed server-side over the
  // relative API URL, so the components pass through untouched. 403 covers tampered,
  // expired, and cross-account links alike — the server does not distinguish (FR-004).
  static async verifyEmail(input: VerifyEmailInput): Promise<VerifyEmailResult> {
    const query = new URLSearchParams({ expires: input.expires, signature: input.signature });
    try {
      const response = await fetch(
        `${Api.base()}/api/email/verify/${encodeURIComponent(input.hash)}?${query.toString()}`,
        { credentials: 'include', headers: { Accept: 'application/json' } },
      );
      if (response.status === 200) {
        const body = (await response.json()) as { data?: RawUser; meta?: { already_verified?: boolean } };
        if (body.data) {
          return { ok: true, user: AuthApi.mapUser(body.data), alreadyVerified: body.meta?.already_verified === true };
        }
        return { ok: false, kind: 'network' };
      }
      if (response.status === 403) {
        return { ok: false, kind: 'invalid' };
      }
      if (response.status === 429) {
        return { ok: false, kind: 'rate-limited' };
      }
      return { ok: false, kind: 'network' };
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  // Request a fresh verification message for the signed-in user (US2, FR-006).
  static async resendVerification(): Promise<ResendResult> {
    try {
      const response = await AuthApi.postJson('/api/email/verification-notification', {});
      if (response.status === 200) {
        return { ok: true };
      }
      if (response.status === 409) {
        return { ok: false, kind: 'already-verified' };
      }
      if (response.status === 429) {
        return { ok: false, kind: 'rate-limited' };
      }
      return { ok: false, kind: 'network' };
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  // Rehydrate auth state from the backend. Anonymous is reported as null whether the API
  // answers 200 {data:null} or 401, so the SPA never trusts a client-only flag (FR-014).
  static async fetchCurrentUser(): Promise<AuthUser | null> {
    try {
      const response = await fetch(`${Api.base()}/api/user`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { data?: RawUser | null };
      return body.data ? AuthApi.mapUser(body.data) : null;
    } catch {
      return null;
    }
  }

  private static async postJson(path: string, body: unknown): Promise<Response> {
    const token = await Csrf.ensure();
    return fetch(`${Api.base()}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': token,
      },
      body: JSON.stringify(body),
    });
  }

  // Shared mapping for register/login: a success status carries the user; 401 is the
  // non-disclosing auth failure; 422 carries field errors; anything else is retryable.
  private static async interpret(response: Response, okStatus: number): Promise<AuthResult> {
    if (response.status === okStatus) {
      const body = (await response.json()) as { data?: RawUser };
      if (body.data) {
        return { ok: true, user: AuthApi.mapUser(body.data) };
      }
      return { ok: false, kind: 'network' };
    }
    if (response.status === 401) {
      return { ok: false, kind: 'auth' };
    }
    // Login only: credentials verified but the account is disabled (FR-013). Register never
    // returns 403, so routing it here is safe for the shared interpreter.
    if (response.status === 403) {
      return { ok: false, kind: 'disabled' };
    }
    if (response.status === 422) {
      const body = (await response.json()) as { errors?: FieldErrors };
      return { ok: false, kind: 'validation', errors: body.errors ?? {} };
    }
    return { ok: false, kind: 'network' };
  }
}
