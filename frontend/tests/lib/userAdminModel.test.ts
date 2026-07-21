import { describe, expect, it } from 'vitest';

import { UserAdminModel } from '../../src/lib/userAdminModel';
import type { RawUserRow, UserRow } from '../../src/lib/userAdminModel';

const rawRow: RawUserRow = {
  hash: 'a1B2c3D4e5',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'member',
  email_verified_at: '2026-07-18 09:31:02',
  created_at: '2026-07-18 09:30:44',
  disabled_at: null,
  disabled_by: null,
};

describe('UserAdminModel.toRow', () => {
  it('maps the raw row into a render-ready row, camelCasing the keys', () => {
    const row = UserAdminModel.toRow(rawRow);

    expect(row).toEqual({
      hash: 'a1B2c3D4e5',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'member',
      emailVerifiedAt: '2026-07-18 09:31:02',
      createdAt: '2026-07-18 09:30:44',
      disabledAt: null,
      disabledBy: null,
      isDisabled: false,
    });
  });

  it('derives isDisabled from the presence of a disabled_at timestamp', () => {
    const disabled = UserAdminModel.toRow({ ...rawRow, disabled_at: '2026-07-19 11:20:00', disabled_by: 'Root' });

    expect(disabled.isDisabled).toBe(true);
    expect(disabled.disabledAt).toBe('2026-07-19 11:20:00');
    expect(disabled.disabledBy).toBe('Root');
  });
});

describe('UserAdminModel.verifiedLabel', () => {
  it('reads a set timestamp as verified — text, never colour alone (FR-005)', () => {
    expect(UserAdminModel.verifiedLabel('2026-07-18 09:31:02')).toBe('Verified');
  });

  it('reads a null timestamp as not verified', () => {
    expect(UserAdminModel.verifiedLabel(null)).toBe('Not verified');
  });
});

describe('UserAdminModel.disabledSummary', () => {
  const active = UserAdminModel.toRow(rawRow);

  it('is null for an active account (an empty disabled cell)', () => {
    expect(UserAdminModel.disabledSummary(active)).toBeNull();
  });

  it('shows the disabled date and the acting account name', () => {
    const row: UserRow = { ...active, disabledAt: '2026-07-19 11:20:00', disabledBy: 'Root', isDisabled: true };

    expect(UserAdminModel.disabledSummary(row)).toBe('2026-07-19 by Root');
  });

  it('degrades to the date alone when the actor is unresolvable (INV-3)', () => {
    const row: UserRow = { ...active, disabledAt: '2026-07-19 11:20:00', disabledBy: null, isDisabled: true };

    expect(UserAdminModel.disabledSummary(row)).toBe('2026-07-19');
  });
});

describe('UserAdminModel.dateOnly', () => {
  it('cuts a raw MySQL datetime down to its date part', () => {
    expect(UserAdminModel.dateOnly('2026-07-18 09:30:44')).toBe('2026-07-18');
  });

  it('passes null through for a timestamp that was never set', () => {
    expect(UserAdminModel.dateOnly(null)).toBeNull();
  });
});

describe('UserAdminModel.replaceRow', () => {
  const rowA = UserAdminModel.toRow(rawRow);
  const rowB = UserAdminModel.toRow({ ...rawRow, hash: 'Zz9Yy8Xx7w', name: 'Spammer' });

  it('replaces the row with a matching hash and leaves the rest identical', () => {
    const updated: UserRow = { ...rowB, disabledAt: '2026-07-19 11:20:00', disabledBy: 'Root', isDisabled: true };

    expect(UserAdminModel.replaceRow([rowA, rowB], updated)).toEqual([rowA, updated]);
  });

  it('is a no-op when the updated row is not on the page', () => {
    const stray: UserRow = { ...rowA, hash: 'missing000' };

    expect(UserAdminModel.replaceRow([rowA, rowB], stray)).toEqual([rowA, rowB]);
  });
});

describe('UserAdminModel.dropRow', () => {
  const rowA = UserAdminModel.toRow(rawRow);
  const rowB = UserAdminModel.toRow({ ...rawRow, hash: 'Zz9Yy8Xx7w', name: 'Spammer' });

  it('drops the row with the matching hash and leaves the others intact', () => {
    expect(UserAdminModel.dropRow([rowA, rowB], rowB.hash)).toEqual([rowA]);
  });

  it('is a no-op when the hash is not on the page', () => {
    expect(UserAdminModel.dropRow([rowA, rowB], 'missing000')).toEqual([rowA, rowB]);
  });
});

describe('UserAdminModel.deleteConfirmMessage', () => {
  it('names the target account in the confirmation copy', () => {
    const message = UserAdminModel.deleteConfirmMessage('Ada');

    expect(message).toContain('Ada');
    // The wording must make the irreversibility explicit (FR-008).
    expect(message.toLowerCase()).toContain('permanent');
  });
});
