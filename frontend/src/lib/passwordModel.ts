// Client-side password rules, shared by every form that accepts a password: register,
// the recovery reset page, and the account page's change section. The server's
// App\Support\PasswordPolicy remains the authority (Principle VI) — these messages are
// byte-equal to Laravel's so a field flagged before submit and the same field flagged
// after read identically.
export class PasswordModel {
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
