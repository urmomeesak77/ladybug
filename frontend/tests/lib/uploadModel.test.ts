import { afterEach, describe, expect, it, vi } from 'vitest';

import { UploadApi } from '../../src/lib/uploadApi';
import { UploadModel } from '../../src/lib/uploadModel';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UploadModel.validate', () => {
  it('requires a file in image mode', () => {
    expect(UploadModel.validate('image', { title: '', file: null, youtube: '' })).toEqual({
      image: ['Choose an image to upload.'],
    });
  });

  it('passes when an image file is present', () => {
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });
    expect(UploadModel.validate('image', { title: '', file, youtube: '' })).toEqual({});
  });

  it('does not require a file in youtube mode', () => {
    expect(UploadModel.validate('youtube', { title: '', file: null, youtube: 'x' })).toEqual({});
  });
});

describe('UploadModel.submit', () => {
  it('routes image mode to UploadApi.uploadImage', async () => {
    const spy = vi.spyOn(UploadApi, 'uploadImage').mockResolvedValue({ ok: true, hash: 'abc1234567' });
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    const result = await UploadModel.submit('image', { title: 't', file, youtube: '' });

    expect(spy).toHaveBeenCalledWith({ title: 't', file });
    expect(result).toEqual({ ok: true, hash: 'abc1234567' });
  });

  it('routes youtube mode to UploadApi.uploadYoutube', async () => {
    const spy = vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: true, hash: 'zzz1234567' });

    const result = await UploadModel.submit('youtube', { title: '', file: null, youtube: 'dQw4w9WgXcQ' });

    expect(spy).toHaveBeenCalledWith({ title: '', youtube: 'dQw4w9WgXcQ' });
    expect(result).toEqual({ ok: true, hash: 'zzz1234567' });
  });
});
