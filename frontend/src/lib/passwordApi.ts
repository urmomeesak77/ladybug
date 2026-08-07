import { Api } from './api';
import type { FieldErrors } from './authApi';
import { Csrf } from './csrf';

// Asking for a recovery link (022, contracts/frontend.md §6). There is deliberately no
// "no such account" outcome: the server answers one 200 for every well-formed address, so
// the client has nothing to distinguish and cannot leak what it does not know (FR-004).
export type RequestLinkResult =
  | { ok: true }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'rate-limited' }
  | { ok: false; kind: 'network' };

// Is a recovery link still alive? 'invalid' is the server's single 403 refusal — expired,
// spent, superseded, tampered, unknown and disabled all arrive as the same answer, and the
// client keeps them that way (FR-015).
export type CheckTokenResult =
  | { ok: true }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'rate-limited' }
  | { ok: false; kind: 'network' };

// What the reset form holds. `passwordConfirmation` is the form's own name for the field;
// the request body renames it to the `password_confirmation` Laravel's `confirmed` validates.
export type ResetInput = {
  hash: string;
  token: string;
  password: string;
  passwordConfirmation: string;
};

// 'validation' and 'invalid' are deliberately separate: a 422 is about the PASSWORD and
// leaves the link usable, a 403 is about the LINK and ends the journey (US2 scenarios 3-4).
export type ResetResult =
  | { ok: true }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'rate-limited' }
  | { ok: false; kind: 'network' };

// Password recovery and change client (022). Same Csrf.ensure() + credentials:'include'
// fetch shape as AuthApi, so the session cookie and the CSRF guard behave identically.
export class PasswordApi {
  static async requestLink(email: string): Promise<RequestLinkResult> {
    try {
      const response = await PasswordApi.postJson('/api/password/forgot', { email });
      // Any 200 is success. Not "the address was found" — the server does not say, and
      // this is the line that keeps the page from being able to pretend otherwise.
      if (response.status === 200) {
        return { ok: true };
      }
      if (response.status === 422) {
        const body = (await response.json()) as { errors?: FieldErrors };
        return { ok: false, kind: 'validation', errors: body.errors ?? {} };
      }
      if (response.status === 429) {
        return { ok: false, kind: 'rate-limited' };
      }
      return { ok: false, kind: 'network' };
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  // Asked once when the reset page opens, so a dead link is refused before a password is
  // composed (research D8). The token travels in the BODY: a query string would land it in
  // nginx's access log, one layer below the fragment chosen to keep it out.
  static async checkToken(hash: string, token: string): Promise<CheckTokenResult> {
    try {
      const response = await PasswordApi.postJson('/api/password/reset/check', { hash, token });
      if (response.status === 204) {
        return { ok: true };
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

  static async reset(input: ResetInput): Promise<ResetResult> {
    try {
      const response = await PasswordApi.postJson('/api/password/reset', {
        hash: input.hash,
        token: input.token,
        password: input.password,
        password_confirmation: input.passwordConfirmation,
      });
      if (response.status === 200) {
        return { ok: true };
      }
      if (response.status === 422) {
        const body = (await response.json()) as { errors?: FieldErrors };
        return { ok: false, kind: 'validation', errors: body.errors ?? {} };
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
}
