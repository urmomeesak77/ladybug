import type { FieldErrors } from './authApi';
import type { ChangePasswordResult } from './passwordApi';

// The ways asking for a recovery link can fail on the client's side of the wire. There is
// no 'unknown-account' member and there never can be: the server answers one 200 for every
// well-formed address, so this list is the whole of what a page is able to say (FR-004).
export type RequestFailureKind = 'rate-limited' | 'network';

// The ways the reset half can fail. 'invalid' covers every dead link there is — expired,
// spent, superseded, tampered, unknown, disabled — because the server answers all of them
// with one 403 and the client must not invent a finer story than it was told (FR-015).
export type ResetFailureKind = 'invalid' | RequestFailureKind;

export type ResetPasswordValues = { password: string; passwordConfirmation: string };

// The account page's form. `currentPassword` is always held — a form field cannot be
// half-present — but it is only ever judged for an account that has one (FR-031).
export type ChangePasswordValues = ResetPasswordValues & { currentPassword: string };

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

  // Why a reset could not be completed, in one plain sentence (FR-023). A dead link gets
  // its own; the other two are the site's existing shared sentences, so a spent rate limit
  // reads the same here as everywhere else.
  static resetFailureMessage(kind: ResetFailureKind): string {
    if (kind === 'invalid') {
      return 'This password recovery link is no longer valid.';
    }
    return PasswordModel.requestFailureMessage(kind);
  }

  // The token out of the link's URL fragment, or null when there is none to read.
  //
  // A fragment is never sent to any server (research D2), which is why the token rides
  // there — and why reading it is the page's own job. Returning null for anything
  // unreadable lets the page refuse locally instead of issuing a request that could only
  // ever be refused.
  static parseResetFragment(hash: string): string | null {
    const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
    if (token === null || !token.trim()) {
      return null;
    }
    return token;
  }

  // The reset form's validator, in the shape useAuthForm speaks. Same policy and the same
  // confirmation rule the register form applies — one wording, so a field flagged here and
  // the same field flagged by the server read identically (FR-013).
  static validateReset(values: ResetPasswordValues, touched?: Set<string>): FieldErrors {
    const errors: FieldErrors = {};
    if (PasswordModel.isTouched(touched, 'password')) {
      const violations = PasswordModel.policyErrors(values.password);
      if (violations.length > 0) {
        errors.password = violations;
      }
    }
    const confirmation = PasswordModel.confirmationErrors(values, touched);
    if (confirmation.length > 0) {
      errors.passwordConfirmation = confirmation;
    }
    return errors;
  }

  // The account page's validator: the reset form's rules plus one field, and that field is
  // asked for only when the account has a password to prove. A Google-only account is not
  // shown an optional box it could leave blank — there is nothing it could put there, and
  // its live session is the proof of identity instead (FR-027, FR-031).
  static validateChange(values: ChangePasswordValues, hasPassword: boolean, touched?: Set<string>): FieldErrors {
    const errors = PasswordModel.validateReset(values, touched);
    const judged = PasswordModel.isTouched(touched, 'currentPassword');
    if (hasPassword && judged && !values.currentPassword) {
      errors.currentPassword = ['Current password is required.'];
    }
    return errors;
  }

  // Why a change was refused, in one sentence (FR-023). The server's own field message wins
  // where there is one — it is the authority on whether the current password was right, and
  // repeating its wording keeps the site saying one thing rather than two.
  static changeFailureMessage(result: ChangePasswordResult): string {
    if (result.ok) {
      return '';
    }
    if (result.kind === 'validation') {
      return result.errors.current_password?.join('\n')
        ?? result.errors.password?.join('\n')
        ?? 'That password cannot be used.';
    }
    if (result.kind === 'auth') {
      return 'Please log in again to change your password.';
    }
    return PasswordModel.requestFailureMessage(result.kind);
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

  private static isTouched(touched: Set<string> | undefined, field: string): boolean {
    return touched === undefined || touched.has(field);
  }

  // The mismatch check waits until both fields are touched and non-empty, matching the
  // register form: filling the confirmation first must not be punished early.
  private static confirmationErrors(values: ResetPasswordValues, touched?: Set<string>): string[] {
    if (PasswordModel.isTouched(touched, 'passwordConfirmation') && !values.passwordConfirmation) {
      return ['Re-type password is required.'];
    }
    const bothTouched = PasswordModel.isTouched(touched, 'password')
      && PasswordModel.isTouched(touched, 'passwordConfirmation');
    const bothFilled = values.password.length > 0 && values.passwordConfirmation.length > 0;
    if (bothTouched && bothFilled && values.password !== values.passwordConfirmation) {
      return ['Passwords do not match.'];
    }
    return [];
  }
}
