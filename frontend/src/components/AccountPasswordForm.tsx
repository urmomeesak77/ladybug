import { useState } from 'react';
import type { FormEvent } from 'react';

import BusyButton from './BusyButton';
import { useAuth } from '../hooks/useAuth';
import { PasswordApi } from '../lib/passwordApi';
import { PasswordModel } from '../lib/passwordModel';
import type { ChangePasswordValues } from '../lib/passwordModel';

const EMPTY: ChangePasswordValues = { currentPassword: '', password: '', passwordConfirmation: '' };

const FORM_ERROR_ID = 'account-password-error';

const GOOGLE_NOTE = 'You sign in with Google. Setting a password adds a second way in — '
  + 'your Google sign-in keeps working.';

// One password field, labelled visibly like the name editor's (the account page shows its
// labels; the auth forms hide theirs behind placeholders).
//
// The message renders INSIDE this field rather than once at the foot of the form, so the
// sighted reading and the accessible one agree: a wrong current password used to print its
// sentence under "Confirm new password", three rows away from the input it was about.
function PasswordField(
  { id, label, autoComplete, value, error, onChange, onBlur }: {
    id: string;
    label: string;
    autoComplete: string;
    value: string;
    error: string;
    onChange: (value: string) => void;
    onBlur: () => void;
  },
) {
  const errorId = `${id}-error`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? <span id={errorId} className="auth-field__error" role="alert">{error}</span> : null}
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
  const { adopt } = useAuth();
  const [values, setValues] = useState<ChangePasswordValues>(EMPTY);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Two readings of the same rules, as the auth forms do it. Untouched judges EVERY field
  // and gates the button; touched judges only what the visitor has finished with and is what
  // gets shown. Before this the errors were counted for the gate and never rendered, so a
  // password that failed the policy left "Save password" greyed out with nothing said —
  // unreachable for a Google-only account, whose whole purpose here is to set a first one.
  const shown = PasswordModel.validateChange(values, hasPassword, touched);
  const incomplete = Object.keys(PasswordModel.validateChange(values, hasPassword)).length > 0;

  function edit(field: keyof ChangePasswordValues, value: string): void {
    setValues({ ...values, [field]: value });
    setError('');
    setErrorField('');
    setSaved(false);
  }

  function markTouched(field: keyof ChangePasswordValues): void {
    setTouched(new Set(touched).add(field));
  }

  // The client error for a field, or the server's refusal when it named that field. The
  // server wins: it is the authority on whether the current password was right.
  function errorFor(field: keyof ChangePasswordValues): string {
    if (errorField === field) {
      return error;
    }
    return shown[field]?.join('\n') ?? '';
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
    setTouched(new Set());
    if (!result.ok) {
      setError(PasswordModel.changeFailureMessage(result));
      setErrorField(PasswordModel.changeFailureField(result));
      return;
    }
    setSaved(true);
    // The response already carries the updated profile — which is what flips `hasPassword`
    // and the sign-in method line for an account that has just gained its first password.
    // Adopting it is why the endpoint answers with a UserResource at all
    // (contracts/account-password-api.md); re-probing /api/user here would be a second round
    // trip for bytes we are holding. The client stays signed in either way (FR-028).
    adopt(result.user);
  }

  return (
    <form className="account__password" onSubmit={handleSubmit} noValidate aria-labelledby="account-password-heading">
      {/* FR-026 wants a LABELLED section. Without a name of its own, a screen reader tabbing
          into the account page hears "Current password, edit text" with no sign that a new
          section began. */}
      <h2 id="account-password-heading" className="account__section-title">Password</h2>
      <fieldset disabled={saving}>
        {hasPassword
          ? (
            <PasswordField
              id="account-current-password"
              label="Current password"
              autoComplete="current-password"
              value={values.currentPassword}
              error={errorFor('currentPassword')}
              onChange={(value) => edit('currentPassword', value)}
              onBlur={() => markTouched('currentPassword')}
            />
          )
          : <p className="account__note">{GOOGLE_NOTE}</p>}
        <PasswordField
          id="account-new-password"
          label="New password"
          autoComplete="new-password"
          value={values.password}
          error={errorFor('password')}
          onChange={(value) => edit('password', value)}
          onBlur={() => markTouched('password')}
        />
        <PasswordField
          id="account-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={values.passwordConfirmation}
          error={errorFor('passwordConfirmation')}
          onChange={(value) => edit('passwordConfirmation', value)}
          onBlur={() => markTouched('passwordConfirmation')}
        />
        {/* Only a refusal that names NO field lands here — a lapsed session, a spent rate
            limit. Anything field-specific renders inside that field instead. */}
        {error && !errorField
          ? <span id={FORM_ERROR_ID} className="auth-field__error" role="alert">{error}</span>
          : null}
        {saved ? <span className="account__saved" role="status">Password updated.</span> : null}
        <BusyButton className="account__save" type="submit" busy={saving} disabled={incomplete}>
          Save password
        </BusyButton>
      </fieldset>
    </form>
  );
}

export default AccountPasswordForm;
