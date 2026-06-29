import { apiBase } from './api';
import type { FieldErrors } from './authApi';

export type UploadResult =
  | { ok: true; hash: string }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  | { ok: false; kind: 'network' };

// Laravel sets the XSRF-TOKEN cookie (URL-encoded); echo it back so Sanctum's CSRF guard
// accepts the unsafe request. Guarded so the non-DOM test env is safe.
function xsrfToken(): string {
  const cookies = typeof document !== 'undefined' ? document.cookie : '';
  const match = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function send(body: FormData | string, jsonContentType: boolean): Promise<UploadResult> {
  try {
    // For FormData we must NOT set Content-Type — the browser adds the multipart boundary.
    const headers: Record<string, string> = { Accept: 'application/json', 'X-XSRF-TOKEN': xsrfToken() };
    if (jsonContentType) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${apiBase()}/api/posts`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
    return await interpret(response);
  } catch {
    return { ok: false, kind: 'network' };
  }
}

async function interpret(response: Response): Promise<UploadResult> {
  if (response.status === 201) {
    const data = (await response.json()) as { data?: { hash?: string } };
    return data.data?.hash ? { ok: true, hash: data.data.hash } : { ok: false, kind: 'network' };
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

export function uploadImage(input: { title: string; file: File }): Promise<UploadResult> {
  const form = new FormData();
  form.set('title', input.title);
  form.set('image', input.file);
  return send(form, false);
}

export function uploadYoutube(input: { title: string; youtube: string }): Promise<UploadResult> {
  return send(JSON.stringify({ title: input.title, youtube: input.youtube }), true);
}
