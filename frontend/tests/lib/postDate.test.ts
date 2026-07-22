import { describe, expect, it } from 'vitest';

import { PostDate } from '../../src/lib/postDate';

describe('PostDate.format', () => {
  it('formats an ISO timestamp as a short absolute date', () => {
    // Pinned to a UTC noon so the calendar day is stable regardless of the test runner's
    // timezone (avoids a midnight-boundary flake).
    expect(PostDate.format('2026-07-22T12:00:00Z')).toBe('Jul 22, 2026');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.format(null)).toBeNull();
    expect(PostDate.format('')).toBeNull();
    expect(PostDate.format('not a date')).toBeNull();
  });
});
