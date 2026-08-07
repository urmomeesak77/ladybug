import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuthForm } from '../hooks/useAuthForm';
import { AuthModel } from '../lib/authModel';
import type { ForgotPasswordValues } from '../lib/authModel';
import { PasswordApi } from '../lib/passwordApi';
import { PasswordModel } from '../lib/passwordModel';

// The one sentence this page is allowed to say about an accepted request. It describes
// what the site did, never what it found — the same words whether the address belongs to
// an account, to a disabled account, or to nobody at all (FR-004).
const CONFIRMATION = 'If an account exists for that address, a password recovery link is on its way. '
  + 'Check that inbox.';

function ForgotPasswordConfirmation() {
  return (
    <>
      <p className="auth-form__notice" role="status">{CONFIRMATION}</p>
      <p className="auth-form__link"><Link to="/login">Back to login</Link></p>
    </>
  );
}

// Ask for a recovery link (022, US1). Structurally the same form as /login — useAuthForm +
// AuthField — so the two read and behave alike (FR-022). Unguarded on purpose: a signed-in
// person must be able to reach it too (research D11).
function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState('');
  const form = useAuthForm<ForgotPasswordValues>({ email: '' }, AuthModel.validateForgotPassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    if (!form.startSubmit()) {
      return;
    }
    form.setSubmitting(true);
    const result = await PasswordApi.requestLink(form.values.email);
    form.setSubmitting(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    if (result.kind === 'validation') {
      form.setServerErrors(result.errors);
      return;
    }
    setFormError(PasswordModel.requestFailureMessage(result.kind));
  }

  return (
    <section className="auth">
      <h1>Reset password</h1>
      {sent ? <ForgotPasswordConfirmation /> : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
          <fieldset disabled={form.submitting}>
            <AuthField
              id="email"
              label="E-mail"
              type="email"
              value={form.values.email}
              autoComplete="email"
              error={form.errors.email?.join('\n')}
              onChange={(value: string) => form.handleChange('email', value)}
              onBlur={() => form.handleBlur('email')}
            />
            <BusyButton type="submit" busy={form.submitting} disabled={form.hasErrors}>
              Send recovery link
            </BusyButton>
          </fieldset>
          <p className="auth-form__link"><Link to="/login">Back to login</Link></p>
        </form>
      )}
    </section>
  );
}

export default ForgotPasswordPage;
