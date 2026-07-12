import { useState } from 'react';

import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// Shared client/server error bookkeeping for the auth forms (login/register): values,
// blur-driven client validation, 422 server errors, and the submit-time sweep. Client
// and server errors are tracked apart so revalidating one field on blur never wipes a
// server-reported error on another (server wins, but only the touched-aware client
// pass may replace clientErrors). Extracted so each page stays inside the 50-line
// function budget (Principle II).
export function useAuthForm<T extends Record<string, string>>(
  initial: T,
  validate: (values: T, touched?: Set<string>) => FieldErrors,
) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(field: keyof T & string, value: string): void {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    // Revalidate touched fields with the new value: a client error clears only when the
    // value actually becomes valid, never just because the user started typing.
    setClientErrors(validate(nextValues, touched));
    // A field's server verdict no longer applies once its value changes.
    setServerErrors(AuthModel.clearFieldError(serverErrors, field));
  }

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setClientErrors(validate(values, nextTouched));
  }

  // The submit-time sweep: touch every field, validate all of them, and report
  // whether the submit may proceed.
  function startSubmit(): boolean {
    setTouched(new Set(Object.keys(initial)));
    const validationErrors = validate(values);
    setClientErrors(validationErrors);
    return Object.keys(validationErrors).length === 0;
  }

  const errors = AuthModel.mergeServerErrors(clientErrors, serverErrors);
  // Gates on client errors only: a lingering server error must not soft-lock the
  // submit button once the user has corrected the field client-side validates.
  const hasErrors = Object.keys(clientErrors).length > 0;

  return {
    values, errors, hasErrors, submitting, setSubmitting, setServerErrors, handleChange, handleBlur, startSubmit,
  };
}
