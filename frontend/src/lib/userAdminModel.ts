// The raw account row as the admin API serializes it (AdminUserResource). Snake_case mirrors
// the JSON; the render-ready UserRow below is the camelCase shape the table reads.
export type RawUserRow = {
  hash: string;
  name: string;
  email: string;
  role: string;
  email_verified_at: string | null;
  created_at: string | null;
  disabled_at: string | null;
  // The disabling account's NAME (never an id — INV-3), or null on an active account or an
  // unresolvable actor.
  disabled_by: string | null;
};

export type UserRow = {
  hash: string;
  name: string;
  email: string;
  role: string;
  // Raw MySQL datetimes (Y-m-d H:i:s) straight from the server, or null when unset.
  emailVerifiedAt: string | null;
  createdAt: string | null;
  disabledAt: string | null;
  disabledBy: string | null;
  // Derived from disabledAt: the single boolean the row and its (US3) control read.
  isDisabled: boolean;
};

// Pure mapping/derivation for the account table: raw→row, state labels, in-place row swap.
// IO lives in lib/userAdminApi; this class never touches the network (Principle II).
export class UserAdminModel {
  // The date part of a raw MySQL datetime (Y-m-d H:i:s); the full value lives in the cell's
  // hover tooltip so the table stays narrow without losing information.
  static dateOnly(value: string | null): string | null {
    return value === null ? null : value.slice(0, 10);
  }

  // The Verified column's text. FR-005 requires the state be conveyed in text, never colour
  // alone: a set verification timestamp reads "Verified", its absence "Not verified".
  static verifiedLabel(emailVerifiedAt: string | null): string {
    return emailVerifiedAt === null ? 'Not verified' : 'Verified';
  }

  // The Disabled column's text: the date the account was disabled and who disabled it, or
  // the date alone when the acting account no longer resolves (INV-3). Null for an active
  // account, which renders as an empty cell — the column header names what an empty cell means.
  static disabledSummary(row: UserRow): string | null {
    if (row.disabledAt === null) {
      return null;
    }
    const date = row.disabledAt.slice(0, 10);
    return row.disabledBy === null ? date : `${date} by ${row.disabledBy}`;
  }

  static toRow(raw: RawUserRow): UserRow {
    return {
      hash: raw.hash,
      name: raw.name,
      email: raw.email,
      role: raw.role,
      emailVerifiedAt: raw.email_verified_at,
      createdAt: raw.created_at,
      disabledAt: raw.disabled_at,
      disabledBy: raw.disabled_by,
      isDisabled: raw.disabled_at !== null,
    };
  }

  // Replace one row in place after a disable/enable action (FR-016); a no-op when the row
  // is not on the page.
  static replaceRow(rows: UserRow[], updated: UserRow): UserRow[] {
    return rows.map((row) => (row.hash === updated.hash ? updated : row));
  }
}
