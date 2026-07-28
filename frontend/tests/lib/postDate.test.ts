import { describe, expect, it } from 'vitest';

import { PostDate } from '../../src/lib/postDate';

// Every input below is a ZONE-LESS ISO date-time. Per ECMA-262 those are parsed as LOCAL
// time, so the input and the expected output sit in the same frame and the assertions hold
// in any timezone — they do not depend on the TZ pin in vite.config.ts. (Do not "tidy" these
// into '...Z' instants: that reintroduces an offset and the clock assertions start splitting
// between a UTC+3 dev machine and the UTC CI runner.) Note a date-ONLY string like
// '2026-07-22' is UTC, not local, which is why these all carry a time component.
describe('PostDate.format', () => {
  it('formats an ISO timestamp as an ISO calendar date', () => {
    expect(PostDate.format('2026-07-22T12:00:00')).toBe('2026-07-22');
  });

  it('zero-pads a single-digit month and day', () => {
    expect(PostDate.format('2026-01-05T12:00:00')).toBe('2026-01-05');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.format(null)).toBeNull();
    expect(PostDate.format('')).toBeNull();
    expect(PostDate.format('not a date')).toBeNull();
  });
});

describe('PostDate.formatWithTime', () => {
  it('appends a 24-hour clock to the ISO date', () => {
    expect(PostDate.formatWithTime('2026-07-22T14:05:00')).toBe('2026-07-22 14:05');
  });

  it('zero-pads a single-digit hour and minute', () => {
    expect(PostDate.formatWithTime('2026-07-22T09:07:00')).toBe('2026-07-22 09:07');
  });

  it('renders midnight as 00:00 rather than 24:00 or 12:00 AM', () => {
    expect(PostDate.formatWithTime('2026-07-22T00:00:00')).toBe('2026-07-22 00:00');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.formatWithTime(null)).toBeNull();
    expect(PostDate.formatWithTime('')).toBeNull();
    expect(PostDate.formatWithTime('not a date')).toBeNull();
  });
});
