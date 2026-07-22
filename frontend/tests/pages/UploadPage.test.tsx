// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UploadPage from '../../src/pages/UploadPage';
import { UploadApi } from '../../src/lib/uploadApi';
import type { UploadResult } from '../../src/lib/uploadApi';

// Lets a test hold the upload request open to observe the in-flight UI state.
function deferredResult() {
  let resolve!: (result: UploadResult) => void;
  const promise = new Promise<UploadResult>((res) => { resolve = res; });
  return { promise, resolve };
}

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
  it('shows the heading exactly "Upload"', () => {
    renderUpload();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Upload');
  });

  it('blocks submission with a field error when the title is empty', async () => {
    const uploadImage = vi.spyOn(UploadApi, 'uploadImage');
    renderUpload();
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    // A file is chosen so the only outstanding rule is the required title.
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/title/i);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('starts on the Image tab with the file picker active', () => {
    renderUpload();

    expect(screen.getByRole('tab', { name: 'Image' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Image file')).toBeTruthy();
    expect(screen.queryByLabelText('YouTube link')).toBeNull();
  });

  it('switches to the YouTube link input when the YouTube tab is chosen', () => {
    renderUpload();

    fireEvent.click(screen.getByRole('tab', { name: 'YouTube' }));

    expect(screen.getByLabelText('YouTube link')).toBeTruthy();
    expect(screen.queryByLabelText('Image file')).toBeNull();
  });

  it('drops the departed tab stale field error when switching tabs', async () => {
    renderUpload();

    // Force an image field error (submit in image mode with no file, but a title present).
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My meme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/choose an image/i);

    // Switching to YouTube must clear the stale image error rather than leave it lingering
    // against a now-hidden input.
    fireEvent.click(screen.getByRole('tab', { name: 'YouTube' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('submits only the active tab value after switching tabs', async () => {
    const uploadYoutube = vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: true, hash: 'clip123456' });
    const uploadImage = vi.spyOn(UploadApi, 'uploadImage');
    renderUpload();
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    // Enter an image, then switch to YouTube and submit — only the YouTube value must go out.
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('tab', { name: 'YouTube' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My clip' } });
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(uploadYoutube).toHaveBeenCalledWith({ title: 'My clip', youtube: 'dQw4w9WgXcQ' }));
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('blocks an image submission without a chosen file', async () => {
    const uploadImage = vi.spyOn(UploadApi, 'uploadImage');
    renderUpload();

    // A title is present so the only outstanding rule is the missing file.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My meme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/choose an image/i);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('posts the meme and navigates to its permalink', async () => {
    vi.spyOn(UploadApi, 'uploadImage').mockResolvedValue({ ok: true, hash: 'newpost001' });
    renderUpload();
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My meme' } });
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/posts/newpost001'));
    expect(UploadApi.uploadImage).toHaveBeenCalledWith({ title: 'My meme', file });
  });

  it('shows a busy spinner and visibly disables the form while the upload runs', async () => {
    const pending = deferredResult();
    vi.spyOn(UploadApi, 'uploadImage').mockReturnValue(pending.promise);
    renderUpload();
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My meme' } });
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    const button = await screen.findByRole('button', { name: 'Posting…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.busy-button__spinner')).not.toBeNull();
    const fieldset = screen.getByLabelText('Title').closest('fieldset');
    expect(fieldset?.disabled).toBe(true);

    pending.resolve({ ok: true, hash: 'newpost001' });

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/posts/newpost001'));
  });

  it('announces a form-level error when the session expired', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: false, kind: 'auth' });
    renderUpload();

    fireEvent.click(screen.getByRole('tab', { name: 'YouTube' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My clip' } });
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/log in again/i);
  });
});
