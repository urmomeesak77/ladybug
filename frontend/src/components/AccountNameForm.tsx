import { useState } from 'react';
import type { FormEvent } from 'react';

import BusyButton from './BusyButton';
import { useAuth } from '../hooks/useAuth';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// The owner's display name, editable in place on the account page. The name must be free
// (the server is the authority — it holds the uniqueness check), so a refusal is shown as
// text under the field like every other form error, never by colour alone (Principle IV).
// Saving refreshes the auth context so the rest of the UI picks the new name up at once.
function AccountNameForm({ name }: { name: string }) {
  const { refresh } = useAuth();
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const trimmed = value.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    const result = await AuthApi.updateName(trimmed);
    setSaving(false);
    if (!result.ok) {
      setError(AuthModel.nameUpdateError(result));
      return;
    }
    setValue(result.user.name);
    setSaved(true);
    await refresh();
  }

  return (
    <form className="account__name" onSubmit={handleSubmit} noValidate>
      <label htmlFor="account-name">Name</label>
      <fieldset disabled={saving}>
        <div className="auth-field">
          <input
            id="account-name"
            type="text"
            value={value}
            autoComplete="nickname"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'account-name-error' : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
              setSaved(false);
            }}
          />
          {error ? <span id="account-name-error" className="auth-field__error" role="alert">{error}</span> : null}
          {saved ? <span className="account__saved" role="status">Name updated.</span> : null}
        </div>
        {/* Nothing to save until the value actually differs from the stored name. */}
        <BusyButton className="account__save" type="submit" busy={saving} disabled={!trimmed || trimmed === name}>
          Save
        </BusyButton>
      </fieldset>
    </form>
  );
}

export default AccountNameForm;
