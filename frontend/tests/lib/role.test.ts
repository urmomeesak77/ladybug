import { describe, expect, it } from 'vitest';

import { Role, type RoleName } from '../../src/lib/role';

// The authoritative low→high ordering mirrored from App\Enums\Role.
const RANKS: Record<RoleName, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  superuser: 3,
};

// SC-004: the exhaustive 16-pair "outranks" matrix from data-model.md.
// A role outranks another iff its rank is strictly higher; equal ⇒ false.
const OUTRANKS: Record<RoleName, RoleName[]> = {
  guest: [],
  member: ['guest'],
  admin: ['guest', 'member'],
  superuser: ['guest', 'member', 'admin'],
};

describe('Role.ORDER', () => {
  it('is the strict low→high vocabulary', () => {
    expect(Role.ORDER).toEqual(['guest', 'member', 'admin', 'superuser']);
  });
});

describe('Role.rank', () => {
  it('is 0/1/2/3 in ascending privilege', () => {
    expect(Role.rank('guest')).toBe(0);
    expect(Role.rank('member')).toBe(1);
    expect(Role.rank('admin')).toBe(2);
    expect(Role.rank('superuser')).toBe(3);
  });
});

describe('Role.outranks (16-pair matrix)', () => {
  for (const a of Role.ORDER) {
    for (const b of Role.ORDER) {
      const expected = RANKS[a] > RANKS[b];
      it(`${a} ${expected ? 'outranks' : 'does not outrank'} ${b}`, () => {
        expect(Role.outranks(a, b)).toBe(expected);
        expect(OUTRANKS[a].includes(b)).toBe(expected); // cross-check the matrix table
      });
    }
  }

  it('a role never outranks itself (equal ranks ⇒ false)', () => {
    for (const role of Role.ORDER) {
      expect(Role.outranks(role, role)).toBe(false);
    }
  });
});

describe('Role.isAssignable', () => {
  it('is false for guest (implicit-only)', () => {
    expect(Role.isAssignable('guest')).toBe(false);
  });

  it('is true for member/admin/superuser', () => {
    expect(Role.isAssignable('member')).toBe(true);
    expect(Role.isAssignable('admin')).toBe(true);
    expect(Role.isAssignable('superuser')).toBe(true);
  });
});
