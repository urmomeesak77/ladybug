// Formats a post's creation timestamp for the byline. In-house (no date library):
// Intl.DateTimeFormat is a platform built-in, so no dependency is added (Principle I).
export class PostDate {
  // Fixed 'en-US' locale so the byline's *format* is the design's 'Jul 22, 2026' for
  // every visitor, rather than varying per browser locale. Timezone is intentionally the
  // viewer's local zone (no `timeZone` option), so the displayed calendar day is the
  // visitor's local day — the conventional "date added" behaviour for a social feed.
  private static readonly formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Returns 'Jul 22, 2026' for a valid ISO string, or null for null/blank/unparseable
  // input so the byline can omit the date rather than print 'Invalid Date'.
  static format(iso: string | null): string | null {
    if (!iso) {
      return null;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return PostDate.formatter.format(date);
  }
}
