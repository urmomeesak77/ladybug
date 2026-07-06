import type { AuthUser, FieldErrors } from './authApi';

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';

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
      const passwordErrors = AuthModel.passwordPolicyErrors(values.password);
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

  static resolveStatus(user: AuthUser | null): AuthStatus {
    return user ? 'authenticated' : 'anonymous';
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

  // Mirrors the server policy (min 8, mixed case, a number — research D3), one message
  // per violation like the prototype, so users see exactly what is missing.
  private static passwordPolicyErrors(password: string): string[] {
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
