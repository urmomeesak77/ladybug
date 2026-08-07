import type { AuthResult, AuthUser, FieldErrors, ResendResult, VerifyEmailInput, VerifyEmailResult } from './authApi';
import { PasswordModel } from './passwordModel';

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';

// The link-landing page's view states (008): all server-derived, all at one URL.
export type VerifyViewState = 'verifying' | 'confirmed' | 'already' | 'failed';

export type VerifyFailureKind = 'invalid' | 'rate-limited' | 'network';

export type RegisterValues = {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
};

export type LoginValues = { email: string; password: string };

// Pragmatic email shape check for instant client feedback; the server remains the
// authority (FR-002). Not RFC-exhaustive by design.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client-side auth form validation and small auth-state helpers, converged onto one class.
// The server re-validates everything (FR-002); these only give instant feedback. A
// `touched` set limits blur-time validation to fields the user has visited (prototype
// behavior); omitting it validates everything, which is what submit does.
export class AuthModel {
  static validateRegister(values: RegisterValues, touched?: Set<string>): FieldErrors {
    const errors: FieldErrors = {};
    if (AuthModel.isTouched(touched, 'name') && !values.name.trim()) {
      errors.name = ['Display name is required.'];
    }
    if (AuthModel.isTouched(touched, 'email')) {
      const emailErrors = AuthModel.emailFieldErrors(values.email);
      if (emailErrors.length > 0) {
        errors.email = emailErrors;
      }
    }
    if (AuthModel.isTouched(touched, 'password')) {
      const passwordErrors = PasswordModel.policyErrors(values.password);
      if (passwordErrors.length > 0) {
        errors.password = passwordErrors;
      }
    }
    const confirmationErrors = AuthModel.confirmationErrors(values, touched);
    if (confirmationErrors.length > 0) {
      errors.passwordConfirmation = confirmationErrors;
    }
    return errors;
  }

  static validateLogin(values: LoginValues, touched?: Set<string>): FieldErrors {
    const errors: FieldErrors = {};
    if (AuthModel.isTouched(touched, 'email')) {
      const emailErrors = AuthModel.emailFieldErrors(values.email);
      if (emailErrors.length > 0) {
        errors.email = emailErrors;
      }
    }
    if (AuthModel.isTouched(touched, 'password') && !values.password) {
      errors.password = ['Password is required.'];
    }
    return errors;
  }

  // Server-reported field errors override the client's optimistic ones; client-only and
  // server-only fields are both retained.
  static mergeServerErrors(client: FieldErrors, server: FieldErrors): FieldErrors {
    return { ...client, ...server };
  }

  // Drops one field's server-reported error, e.g. once its value changes and the prior
  // server verdict no longer applies. A no-op copy is returned when the key is absent.
  static clearFieldError(errors: FieldErrors, field: string): FieldErrors {
    if (!(field in errors)) {
      return errors;
    }
    const next = { ...errors };
    delete next[field];
    return next;
  }

  static resolveStatus(user: AuthUser | null): AuthStatus {
    return user ? 'authenticated' : 'anonymous';
  }

  // How this account signs in, in words (FR-029, Principle IV — never an icon or a
  // colour). This sentence is also the ONLY disclosure that a Google link was
  // auto-attached to a pre-existing password account, so it names both doors when
  // both exist rather than just the one most recently used. An account claiming
  // neither door cannot be created; the fallback keeps the function total.
  static signInMethod(user: AuthUser): string {
    if (!user.googleLinkedAt) {
      return 'Email and password';
    }
    return user.hasPassword ? 'Google and email/password' : 'Google';
  }

  // Why a name change was refused, in one sentence. The server's own field message wins
  // when it sent one (it knows about names already taken); the rest are the generic
  // fallbacks the auth forms use.
  static nameUpdateError(result: AuthResult): string {
    if (result.ok) {
      return '';
    }
    if (result.kind === 'validation') {
      return result.errors.name?.join('\n') ?? 'That name cannot be used.';
    }
    if (result.kind === 'auth') {
      return 'Please log in again to change your name.';
    }
    return 'Something went wrong. Please check your connection and try again.';
  }

  // Extract a verification link's components from the route param + query. Any missing
  // or blank piece means the link cannot possibly validate, so the page can render the
  // failure state without issuing a doomed request (contracts/frontend.md).
  static parseVerifyParams(hash: string | undefined, query: URLSearchParams): VerifyEmailInput | null {
    const cleanHash = (hash ?? '').trim();
    const expires = (query.get('expires') ?? '').trim();
    const signature = (query.get('signature') ?? '').trim();
    if (!cleanHash || !expires || !signature) {
      return null;
    }
    return { hash: cleanHash, expires, signature };
  }

  static verifyViewState(result: VerifyEmailResult): VerifyViewState {
    if (result.ok) {
      return result.alreadyVerified ? 'already' : 'confirmed';
    }
    return 'failed';
  }

  // User feedback for a resend attempt, shared by the notice, landing, and account
  // pages (FR-006/FR-008). One message per outcome, stated in text (Principle IV).
  static resendFeedback(result: ResendResult): string {
    if (result.ok) {
      return 'Verification link sent. Check your inbox.';
    }
    if (result.kind === 'already-verified') {
      return 'Your e-mail is already verified.';
    }
    if (result.kind === 'rate-limited') {
      return 'Too many attempts. Please try again in a minute.';
    }
    return 'Something went wrong. Please check your connection and try again.';
  }

  // One message per failure kind, stated in text (Principle IV). Rate-limit and network
  // failures are retryable and say so; an invalid link points at the resend path (US2).
  static verifyFailureMessage(kind: VerifyFailureKind): string {
    if (kind === 'invalid') {
      return 'This verification link is invalid or expired.';
    }
    if (kind === 'rate-limited') {
      return 'Too many attempts. Please try again in a minute.';
    }
    return 'Something went wrong. Please check your connection and try again.';
  }

  private static isTouched(touched: Set<string> | undefined, field: string): boolean {
    return touched === undefined || touched.has(field);
  }

  private static emailFieldErrors(email: string): string[] {
    if (!email.trim()) {
      return ['E-mail is required.'];
    }
    if (!EMAIL_PATTERN.test(email)) {
      return ['Enter a valid email address.'];
    }
    return [];
  }

  // The mismatch check waits until BOTH password fields are touched and non-empty
  // (prototype behavior) so filling the confirmation first is not punished early.
  private static confirmationErrors(values: RegisterValues, touched?: Set<string>): string[] {
    if (AuthModel.isTouched(touched, 'passwordConfirmation') && !values.passwordConfirmation) {
      return ['Re-type password is required.'];
    }
    const bothTouched = AuthModel.isTouched(touched, 'password')
      && AuthModel.isTouched(touched, 'passwordConfirmation');
    const bothFilled = values.password.length > 0 && values.passwordConfirmation.length > 0;
    if (bothTouched && bothFilled && values.password !== values.passwordConfirmation) {
      return ['Passwords do not match.'];
    }
    return [];
  }
}
