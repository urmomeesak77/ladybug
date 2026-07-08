// Frontend mirror of the backend App\Enums\Role contract (FR-012): the same closed,
// strictly-ordered role set and "outranks" comparison. Generation/persistence of a
// role lives only on the backend; this class is the shared vocabulary the auth
// context and future privilege gating read from.
export type RoleName = 'guest' | 'member' | 'admin' | 'superuser';

export class Role {
  // Strict low→high order; the index in this array is the role's rank.
  static readonly ORDER: readonly RoleName[] = ['guest', 'member', 'admin', 'superuser'];

  /** Privilege rank 0..3 (guest 0 → superuser 3). */
  static rank(role: RoleName): number {
    return Role.ORDER.indexOf(role);
  }

  /** True iff `a` is more privileged than `b`; equal ranks return false. */
  static outranks(a: RoleName, b: RoleName): boolean {
    return Role.rank(a) > Role.rank(b);
  }

  /** True for a role a real account may hold (member/admin/superuser); guest is implicit-only. */
  static isAssignable(role: RoleName): boolean {
    return role !== 'guest';
  }
}
