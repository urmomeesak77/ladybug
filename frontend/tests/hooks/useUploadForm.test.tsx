// @vitest-environment jsdom
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUploadForm } from '../../src/hooks/useUploadForm';
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

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/upload']}>
      <LocationProbe />
      {children}
    </MemoryRouter>
  );
}

describe('useUploadForm', () => {
  it('blocks an image submission without a file, before any request', async () => {
    const uploadImage = vi.spyOn(UploadApi, 'uploadImage');
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    await act(() => result.current.submit());

    expect(result.current.errors.image?.[0]).toMatch(/choose an image/i);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('navigates to the new post after a successful upload', async () => {
    vi.spyOn(UploadApi, 'uploadImage').mockResolvedValue({ ok: true, hash: 'newpost001' });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setFile(new File(['x'], 'm.jpg', { type: 'image/jpeg' })));
    await act(() => result.current.submit());

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/posts/newpost001'));
  });

  it('submits a YouTube post through the youtube endpoint', async () => {
    const uploadYoutube = vi
      .spyOn(UploadApi, 'uploadYoutube')
      .mockResolvedValue({ ok: true, hash: 'newpost002' });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setMode('youtube'));
    act(() => result.current.setTitle('Song'));
    act(() => result.current.setYoutube('dQw4w9WgXcQ'));
    await act(() => result.current.submit());

    expect(uploadYoutube).toHaveBeenCalledWith({ title: 'Song', youtube: 'dQw4w9WgXcQ' });
  });

  it('surfaces server field errors on a 422', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({
      ok: false,
      kind: 'validation',
      errors: { youtube: ['Enter a valid YouTube link.'] },
    });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setMode('youtube'));
    await act(() => result.current.submit());

    expect(result.current.errors.youtube?.[0]).toMatch(/valid youtube link/i);
  });

  it('asks the user to log in again on an auth failure', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: false, kind: 'auth' });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setMode('youtube'));
    await act(() => result.current.submit());

    expect(result.current.formError).toMatch(/log in again/i);
  });

  it('shows the verification message when the API says unverified', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: false, kind: 'unverified' });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setMode('youtube'));
    await act(() => result.current.submit());

    expect(result.current.formError).toBe('Verify your e-mail address before posting.');
  });

  it('shows a generic retryable message on a network failure', async () => {
    vi.spyOn(UploadApi, 'uploadYoutube').mockResolvedValue({ ok: false, kind: 'network' });
    const { result } = renderHook(() => useUploadForm(), { wrapper });

    act(() => result.current.setMode('youtube'));
    await act(() => result.current.submit());

    expect(result.current.formError).toMatch(/something went wrong/i);
  });
});
