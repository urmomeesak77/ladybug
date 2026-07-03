// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UploadMediaField from '../../src/components/UploadMediaField';

afterEach(cleanup);

describe('UploadMediaField', () => {
  it('renders the YouTube link field in youtube mode and reports input', () => {
    const onYoutube = vi.fn();
    render(
      <UploadMediaField mode="youtube" youtube="" errors={{}} onFile={vi.fn()} onYoutube={onYoutube} />,
    );

    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'dQw4w9WgXcQ' } });

    expect(onYoutube).toHaveBeenCalledWith('dQw4w9WgXcQ');
  });

  it('renders a file picker limited to the accepted image types in image mode', () => {
    render(
      <UploadMediaField mode="image" youtube="" errors={{}} onFile={vi.fn()} onYoutube={vi.fn()} />,
    );

    const input = screen.getByLabelText('Image file');
    expect(input.getAttribute('type')).toBe('file');
    expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/gif');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the chosen file, and null when the selection is cleared', () => {
    const onFile = vi.fn();
    render(
      <UploadMediaField mode="image" youtube="" errors={{}} onFile={onFile} onYoutube={vi.fn()} />,
    );
    const file = new File(['x'], 'm.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } });
    expect(onFile).toHaveBeenLastCalledWith(file);

    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [] } });
    expect(onFile).toHaveBeenLastCalledWith(null);
  });

  it('associates an image error with the file input as an alert', () => {
    render(
      <UploadMediaField
        mode="image"
        youtube=""
        errors={{ image: ['Choose an image to upload.'] }}
        onFile={vi.fn()}
        onYoutube={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Image file');
    expect(screen.getByRole('alert').textContent).toBe('Choose an image to upload.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('image-error');
  });
});
