// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import PostProcessing from '../../src/components/PostProcessing';

afterEach(() => {
  cleanup();
});

function renderState(state: 'processing' | 'failed') {
  return render(
    <MemoryRouter>
      <PostProcessing state={state} />
    </MemoryRouter>,
  );
}

describe('PostProcessing', () => {
  it('announces a processing upload as a polite status in words', () => {
    renderState('processing');

    expect(screen.getByRole('status').textContent).toContain(
      'Your upload is being processed. This page will update by itself.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the spinner out of the accessibility tree', () => {
    const { container } = renderState('processing');

    const spinner = container.querySelector('.post-processing__spinner');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reports a failed upload as an alert with a way to upload again', () => {
    renderState('failed');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("We couldn't process this upload.");
    expect(screen.getByRole('link', { name: 'Upload it again' }).getAttribute('href')).toBe('/upload');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no spinner once processing has failed', () => {
    const { container } = renderState('failed');

    expect(container.querySelector('.post-processing__spinner')).toBeNull();
  });
});
