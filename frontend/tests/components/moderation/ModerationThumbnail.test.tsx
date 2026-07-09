// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ModerationThumbnail from '../../../src/components/moderation/ModerationThumbnail';

afterEach(cleanup);

describe('ModerationThumbnail', () => {
  it('renders an image with the given alt text and a clipped class', () => {
    render(<ModerationThumbnail src="http://localhost/storage/x.jpg" alt="Funny cat" />);

    const img = screen.getByAltText('Funny cat');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('http://localhost/storage/x.jpg');
    expect(img.className).toContain('moderation-thumb');
  });

  it('shows a labelled placeholder instead of an image when src is null (FR-011)', () => {
    render(<ModerationThumbnail src={null} alt="Funny cat" />);

    expect(screen.queryByRole('img', { name: 'Funny cat' })).toBeNull();
    expect(screen.getByRole('img', { name: 'No thumbnail' })).toBeTruthy();
  });

  it('swaps to the placeholder when the image fails to load', () => {
    render(<ModerationThumbnail src="http://localhost/broken.jpg" alt="Funny cat" />);

    fireEvent.error(screen.getByAltText('Funny cat'));

    expect(screen.queryByAltText('Funny cat')).toBeNull();
    expect(screen.getByRole('img', { name: 'No thumbnail' })).toBeTruthy();
  });
});
