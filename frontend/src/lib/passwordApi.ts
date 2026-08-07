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
