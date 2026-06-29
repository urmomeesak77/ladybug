import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadImage, uploadYoutube } from '../../src/lib/uploadApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadApi', () => {
  it('returns the new hash on a 201', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { data: { hash: 'abc1234567' } }),
    );

    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    const result = await uploadImage({ title: 'hi', file });

    expect(result).toEqual({ ok: true, hash: 'abc1234567' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('sends youtube submissions as JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { data: { hash: 'zzz1234567' } }),
    );

    const result = await uploadYoutube({ title: '', youtube: 'dQw4w9WgXcQ' });

    expect(result).toEqual({ ok: true, hash: 'zzz1234567' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('maps 401 to an auth failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, {}));
    const result = await uploadYoutube({ title: '', youtube: 'dQw4w9WgXcQ' });
    expect(result).toEqual({ ok: false, kind: 'auth' });
  });

  it('maps 422 to field errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(422, { errors: { youtube: ['Enter a valid YouTube link.'] } }),
    );
    const result = await uploadYoutube({ title: '', youtube: 'bad' });
    expect(result).toEqual({ ok: false, kind: 'validation', errors: { youtube: ['Enter a valid YouTube link.'] } });
  });

  it('maps a network rejection to a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    const result = await uploadImage({ title: '', file });
    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});
