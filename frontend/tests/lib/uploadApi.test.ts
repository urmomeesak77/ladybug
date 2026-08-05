// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadApi } from '../../src/lib/uploadApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Csrf.ensure() short-circuits on an existing cookie; without one it inserts a priming
// fetch call ahead of the real request and shifts mock.calls[0] out from under these
// assertions.
beforeEach(() => {
  document.cookie = 'XSRF-TOKEN=test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('uploadApi', () => {
  it('returns the new hash on a 201', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { data: { hash: 'abc1234567' } }),
    );

    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    const result = await UploadApi.uploadImage({ title: 'hi', file });

    expect(result).toEqual({ ok: true, hash: 'abc1234567' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('sends a video field on a video upload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { data: { hash: 'vid1234567' } }),
    );

    const file = new File(['x'], 'm.mp4', { type: 'video/mp4' });
    const result = await UploadApi.uploadVideo({ title: 'hi', file });

    expect(result).toEqual({ ok: true, hash: 'vid1234567' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('video')).toBe(file);
  });

  it('sends youtube submissions as JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { data: { hash: 'zzz1234567' } }),
    );

    const result = await UploadApi.uploadYoutube({ title: '', youtube: 'dQw4w9WgXcQ' });

    expect(result).toEqual({ ok: true, hash: 'zzz1234567' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('maps 401 to an auth failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, {}));
    const result = await UploadApi.uploadYoutube({ title: '', youtube: 'dQw4w9WgXcQ' });
    expect(result).toEqual({ ok: false, kind: 'auth' });
  });

  it('maps 403 to an unverified result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(403, {}));
    const result = await UploadApi.uploadYoutube({ title: '', youtube: 'dQw4w9WgXcQ' });
    expect(result).toEqual({ ok: false, kind: 'unverified' });
  });

  it('maps 422 to field errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(422, { errors: { youtube: ['Enter a valid YouTube link.'] } }),
    );
    const result = await UploadApi.uploadYoutube({ title: '', youtube: 'bad' });
    expect(result).toEqual({ ok: false, kind: 'validation', errors: { youtube: ['Enter a valid YouTube link.'] } });
  });

  it('maps a network rejection to a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    const result = await UploadApi.uploadImage({ title: '', file });
    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('maps a network rejection to a network failure for a video upload', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const file = new File(['x'], 'm.mp4', { type: 'video/mp4' });
    const result = await UploadApi.uploadVideo({ title: '', file });
    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});
