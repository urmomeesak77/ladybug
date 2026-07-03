// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UploadPage from '../../src/pages/UploadPage';
import { UploadApi } from '../../src/lib/uploadApi';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Surfaces the current route in the DOM so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderUpload() {
  render(
    <MemoryRouter initialEntries={['/upload']}>
      <LocationProbe />
      <UploadPage />
    </MemoryRouter>,
  );
}

describe('UploadPage', () => {
  it('starts in image mode with the file picker active', () => {
    renderUpload();

    expect(screen.getByRole('radio', { name: 'Image' })).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Image file')).toBeTruthy();
    expect(screen.queryByLabelText('YouTube link')).toBeNull();
  });

  it('switches to the YouTube link input in youtube mode', () => {
    renderUpload();

    fireEvent.click(screen.getByRole('radio', { name: 'YouTube' }));

    expect(screen.getByLabelText('YouTube link')).toBeTruthy();
    expect(screen.queryByLabelText('Image file')).toBeNull();
  });

  it('blocks an image submission without a chosen file', async () => {
    const uploadImage = vi.spyOn(UploadApi, 'uploadImage');
    renderUpload();

    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/choose an image/i);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('posts the meme and navigates to its permalink', async () => {
    vi.spyOn(UploadApi, 'uploadImage').mockResolvedValue({ ok: true, hash: 'newpost001' });
    renderUpload();
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'My meme' } });
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/posts/newpost001'));
    expect(UploadApi.uploadImage).toHaveBeenCalledWith({ title: 'My meme', file });
  });

  it('announces a form-level error when the session expired', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: false, kind: 'auth' });
    renderUpload();

    fireEvent.click(screen.getByRole('radio', { name: 'YouTube' }));
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/log in again/i);
  });
});
