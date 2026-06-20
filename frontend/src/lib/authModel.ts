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

function emailFieldError(email: string): string | null {
  if (!email.trim()) {
    return 'Email is required.';
  }
  if (!EMAIL_PATTERN.test(email)) {
    return 'Enter a valid email address.';
  }
  return null;
}

// Mirrors the server policy (min 8, mixed case, a number — research D3) so users get
// feedback before submitting; the server re-validates regardless.
function passwordPolicyError(password: string): string | null {
  if (!password) {
    return 'Password is required.';
  }
  const longEnough = password.length >= 8;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (longEnough && hasLower && hasUpper && hasNumber) {
    return null;
  }
  return 'Password must be at least 8 characters and include upper and lower case letters and a number.';
}

export function validateRegister(values: RegisterValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) {
    errors.name = ['Name is required.'];
  }
  const emailError = emailFieldError(values.email);
  if (emailError) {
    errors.email = [emailError];
  }
  const passwordError = passwordPolicyError(values.password);
  if (passwordError) {
    errors.password = [passwordError];
  }
  if (values.password !== values.passwordConfirmation) {
    errors.passwordConfirmation = ['Passwords do not match.'];
  }
  return errors;
}

export function validateLogin(values: LoginValues): FieldErrors {
  const errors: FieldErrors = {};
  const emailError = emailFieldError(values.email);
  if (emailError) {
    errors.email = [emailError];
  }
  if (!values.password) {
    errors.password = ['Password is required.'];
  }
  return errors;
}

// Server-reported field errors override the client's optimistic ones; client-only and
// server-only fields are both retained.
export function mergeServerErrors(client: FieldErrors, server: FieldErrors): FieldErrors {
  return { ...client, ...server };
}

export function resolveStatus(user: AuthUser | null): AuthStatus {
  return user ? 'authenticated' : 'anonymous';
}
