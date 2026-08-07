// The ways asking for a recovery link can fail on the client's side of the wire. There is
// no 'unknown-account' member and there never can be: the server answers one 200 for every
// well-formed address, so this list is the whole of what a page is able to say (FR-004).
export type RequestFailureKind = 'rate-limited' | 'network';

// Client-side password rules, shared by every form that accepts a password: register,
// the recovery reset page, and the account page's change section. The server's
// App\Support\PasswordPolicy remains the authority (Principle VI) — these messages are
// byte-equal to Laravel's so a field flagged before submit and the same field flagged
// after read identically.
export class PasswordModel {
  // Why a recovery link could not be asked for, in one plain sentence (FR-023 — never a
  // colour or an icon). Neither sentence names an account, because neither failure knows
  // of one: both are about the caller's own request. The wording is byte-equal to the
  // verification flow's on purpose, so the site says one thing about a spent rate limit
  // and one about a lost connection; passwordModel.test.ts asserts that equality rather
  // than trusting it.
  static requestFailureMessage(kind: RequestFailureKind): string {
    if (kind === 'rate-limited') {
      return 'Too many attempts. Please try again in a minute.';
    }
    return 'Something went wrong. Please check your connection and try again.';
  }

  // Mirrors the server policy (min 8, mixed case, a number — research D9), one message
  // per violation like the prototype, so users see exactly what is missing.
  static policyErrors(password: string): string[] {
    if (!password) {
      return ['Password is required.'];
    }
    const violations: string[] = [];
    if (password.length < 8) {
      violations.push('The password field must be at least 8 characters.');
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
      violations.push('The password field must contain at least one uppercase and one lowercase letter.');
    }
    if (!/[0-9]/.test(password)) {
      violations.push('The password field must contain at least one number.');
    }
    return violations;
  }
}
