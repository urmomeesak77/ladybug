import { Api } from './api';
import { Csrf } from './csrf';
import type { FieldErrors } from './authApi';

export type UploadResult =
  | { ok: true; hash: string }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  | { ok: false; kind: 'unverified' }
  | { ok: false; kind: 'network' };

// POST /api/posts client. Converges the two submission shapes (multipart image, JSON
// YouTube link) and the shared send/interpret plumbing onto one cohesive class.
export class UploadApi {
  static uploadImage(input: { title: string; file: File }): Promise<UploadResult> {
    const form = new FormData();
    form.set('title', input.title);
    form.set('image', input.file);
    return UploadApi.send(form, false);
  }

  static uploadYoutube(input: { title: string; youtube: string }): Promise<UploadResult> {
    const body = JSON.stringify({ title: input.title, youtube: input.youtube });
    return UploadApi.send(body, true);
  }

  private static async send(body: FormData | string, isJson: boolean): Promise<UploadResult> {
    try {
      // For FormData we must NOT set Content-Type — the browser adds the multipart boundary.
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-XSRF-TOKEN': Csrf.token(),
      };
      if (isJson) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(`${Api.base()}/api/posts`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body,
      });
      return await UploadApi.interpret(response);
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  private static async interpret(response: Response): Promise<UploadResult> {
    if (response.status === 201) {
      const data = (await response.json()) as { data?: { hash?: string } };
      return data.data?.hash ? { ok: true, hash: data.data.hash } : { ok: false, kind: 'network' };
    }
    if (response.status === 401) {
      return { ok: false, kind: 'auth' };
    }
    if (response.status === 403) {
      // The 'verified' middleware refused: the session is fine but the e-mail is not
      // verified (possible when verification state changed after the route gate passed).
      return { ok: false, kind: 'unverified' };
    }
    if (response.status === 422) {
      const body = (await response.json()) as { errors?: FieldErrors };
      return { ok: false, kind: 'validation', errors: body.errors ?? {} };
    }
    return { ok: false, kind: 'network' };
  }
}
