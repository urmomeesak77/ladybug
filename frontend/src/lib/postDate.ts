// Formats a post's creation timestamp for the byline and the comment list. In-house
// (no date library, Principle I) and no Intl either: Intl was only ever pinning the
// format against browser-locale drift, and it cannot produce 'yyyy-mm-dd hh:mm' without
// formatToParts surgery. Padded local getters give the same guarantee in ten lines.
export class PostDate {
  // Timezone is intentionally the viewer's local zone (local getters, not getUTC*), so the
  // displayed day and clock are the visitor's own — the conventional "posted at" behaviour
  // for a social feed.
  static format(iso: string | null): string | null {
    const date = PostDate.parse(iso);
    return date === null ? null : PostDate.datePart(date);
  }

  // The comment list needs minute precision — several comments routinely land on the same
  // day. Shares datePart() with format(), so the date half can never drift from the byline's.
  static formatWithTime(iso: string | null): string | null {
    const date = PostDate.parse(iso);
    if (date === null) {
      return null;
    }
    return `${PostDate.datePart(date)} ${PostDate.timePart(date)}`;
  }

  // Null for null/blank/unparseable input so callers can omit the element entirely rather
  // than print 'Invalid Date'.
  private static parse(iso: string | null): Date | null {
    if (!iso) {
      return null;
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private static datePart(date: Date): string {
    const month = PostDate.pad(date.getMonth() + 1);
    return `${date.getFullYear()}-${month}-${PostDate.pad(date.getDate())}`;
  }

  private static timePart(date: Date): string {
    return `${PostDate.pad(date.getHours())}:${PostDate.pad(date.getMinutes())}`;
  }

  private static pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
