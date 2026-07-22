// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionIcon } from '../../../src/components/moderation/ActionGlyph';

afterEach(cleanup);

describe('ActionIcon', () => {
  it('renders a decorative svg with a path for each glyph', () => {
    for (const glyph of ['activate', 'deactivate', 'delete', 'restore'] as const) {
      const { container } = render(<ActionIcon glyph={glyph} />);
      const svg = container.querySelector('svg[aria-hidden="true"]');
      expect(svg).toBeTruthy();
      expect(svg?.querySelector('path')?.getAttribute('d')).toBeTruthy();
      cleanup();
    }
  });
});
