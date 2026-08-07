import { useState } from 'react';
import type { FormEvent } from 'react';

import BusyButton from './BusyButton';
import { useAuth } from '../hooks/useAuth';
import { PasswordApi } from '../lib/passwordApi';
import type { ChangePasswordResult } from '../lib/passwordApi';
import { PasswordModel } from '../lib/passwordModel';
import type { ChangePasswordValues } from '../lib/passwordModel';

const EMPTY: ChangePasswordValues = { currentPassword: '', password: '', passwordConfirmation: '' };

const ERROR_ID = 'account-password-error';

const GOOGLE_NOTE = 'You sign in with Google. Setting a password adds a second way in — '
  + 'your Google sign-in keeps working.';

// Which field a refusal is about, so the message can be tied to that input alone: a wrong
// current password says nothing about the new one, and must not mark it invalid. A failure
// that names no field — a lapsed session, a spent rate limit — belongs to the form, and
// role="alert" carries it without any input claiming to be wrong.
function fieldFor(result: ChangePasswordResult): string {
  if (result.ok || result.kind !== 'validation') {
    return '';
  }
  return result.errors.current_password ? 'currentPassword' : 'password';
}

// One password field, labelled visibly like the name editor's (the account page shows its
// labels; the auth forms hide theirs behind placeholders). `invalid` carries both halves of
// the accessible refusal — the text tie and the state — because they are never true apart.
function PasswordField(
  { id, label, autoComplete, value, invalid, onChange }: {
    id: string;
    label: string;
    autoComplete: string;
    value: string;
    invalid: boolean;
    onChange: (value: string) => void;
  },
) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? ERROR_ID : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// The deliberate half of password management (022, US3): changing the password from the
// account page, with no inbox and no link involved. Two shapes, chosen from the account's
// own `hasPassword` — an account that arrived through Google has no credential to prove, so
// the current-password field is ABSENT rather than optional, and the page says so in words
// (FR-031). Every field is cleared on every outcome: a password left in an input is a
// password left on a shared screen.
function AccountPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { refresh } = useAuth();
  const [values, setValues] = useState<ChangePasswordValues>(EMPTY);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const incomplete = Object.keys(PasswordModel.validateChange(values, hasPassword)).length > 0;

  function edit(field: keyof ChangePasswordValues, value: string): void {
    setValues({ ...values, [field]: value });
    setError('');
    setErrorField('');
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setErrorField('');
    setSaved(false);
    setSaving(true);
    const result = await PasswordApi.changePassword(values);
    setSaving(false);
    setValues(EMPTY);
    if (!result.ok) {
      setError(PasswordModel.changeFailureMessage(result));
      setErrorField(fieldFor(result));
      return;
    }
    setSaved(true);
    // The refreshed profile is what flips `hasPassword` and the sign-in method line for an
    // account that has just gained its first password. The client stays signed in (FR-028).
    await refresh();
  }

  return (
    <form className="account__password" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={saving}>
        {hasPassword
          ? (
            <PasswordField
              id="account-current-password"
              label="Current password"
              autoComplete="current-password"
              value={values.currentPassword}
              invalid={errorField === 'currentPassword'}
              onChange={(value) => edit('currentPassword', value)}
            />
          )
          : <p className="account__note">{GOOGLE_NOTE}</p>}
        <PasswordField
          id="account-new-password"
          label="New password"
          autoComplete="new-password"
          value={values.password}
          invalid={errorField === 'password'}
          onChange={(value) => edit('password', value)}
        />
        <PasswordField
          id="account-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={values.passwordConfirmation}
          invalid={false}
          onChange={(value) => edit('passwordConfirmation', value)}
        />
        {/* Laravel's `confirmed` rule reports a mismatch against `password`, so the
            confirmation field is never the one the server names. */}
        {error ? <span id={ERROR_ID} className="auth-field__error" role="alert">{error}</span> : null}
        {saved ? <span className="account__saved" role="status">Password updated.</span> : null}
        <BusyButton className="account__save" type="submit" busy={saving} disabled={incomplete}>
          Save password
        </BusyButton>
      </fieldset>
    </form>
  );
}

export default AccountPasswordForm;
