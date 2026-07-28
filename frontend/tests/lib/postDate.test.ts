import { describe, expect, it } from 'vitest';

import { PostDate } from '../../src/lib/postDate';

// The suite runs with TZ=UTC pinned in vite.config.ts, so these instants render as written.
describe('PostDate.format', () => {
  it('formats an ISO timestamp as an ISO calendar date', () => {
    expect(PostDate.format('2026-07-22T12:00:00Z')).toBe('2026-07-22');
  });

  it('zero-pads a single-digit month and day', () => {
    expect(PostDate.format('2026-01-05T12:00:00Z')).toBe('2026-01-05');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.format(null)).toBeNull();
    expect(PostDate.format('')).toBeNull();
    expect(PostDate.format('not a date')).toBeNull();
  });
});
