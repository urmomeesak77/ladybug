import { afterEach, describe, expect, it, vi } from 'vitest';

import * as uploadApi from '../../src/lib/uploadApi';
import { submitUpload, validateUpload } from '../../src/lib/uploadModel';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateUpload', () => {
  it('requires a file in image mode', () => {
    expect(validateUpload('image', { title: '', file: null, youtube: '' })).toEqual({
      image: ['Choose an image to upload.'],
    });
  });

  it('passes when an image file is present', () => {
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    expect(validateUpload('image', { title: '', file, youtube: '' })).toEqual({});
  });

  it('does not require a file in youtube mode', () => {
    expect(validateUpload('youtube', { title: '', file: null, youtube: 'x' })).toEqual({});
  });
});

describe('submitUpload', () => {
  it('routes image mode to uploadImage', async () => {
    const spy = vi.spyOn(uploadApi, 'uploadImage').mockResolvedValue({ ok: true, hash: 'abc1234567' });
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    const result = await submitUpload('image', { title: 't', file, youtube: '' });

    expect(spy).toHaveBeenCalledWith({ title: 't', file });
    expect(result).toEqual({ ok: true, hash: 'abc1234567' });
  });

  it('routes youtube mode to uploadYoutube', async () => {
    const spy = vi.spyOn(uploadApi, 'uploadYoutube').mockResolvedValue({ ok: true, hash: 'zzz1234567' });

    const result = await submitUpload('youtube', { title: '', file: null, youtube: 'dQw4w9WgXcQ' });

    expect(spy).toHaveBeenCalledWith({ title: '', youtube: 'dQw4w9WgXcQ' });
    expect(result).toEqual({ ok: true, hash: 'zzz1234567' });
  });
});
