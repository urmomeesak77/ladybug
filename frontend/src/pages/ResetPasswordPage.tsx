import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuthForm } from '../hooks/useAuthForm';
import { PasswordApi } from '../lib/passwordApi';
import { PasswordModel } from '../lib/passwordModel';
import type { ResetPasswordValues } from '../lib/passwordModel';

// One address, four states, all restored by Back/Forward/Refresh (FR-024).
type ResetViewState = 'checking' | 'form' | 'dead' | 'done';

function ResetOutcome({ view }: { view: ResetViewState }) {
  if (view === 'done') {
    return (
      <>
        <p className="auth-form__notice" role="status">Your password has been changed. Please log in.</p>
        <p className="auth-form__link"><Link to="/login">Go to login</Link></p>
      </>
    );
  }
  return (
    <>
      <p className="auth-form__notice" role="status">{PasswordModel.resetFailureMessage('invalid')}</p>
      <p className="auth-form__link"><Link to="/forgot-password">Request a new link</Link></p>
    </>
  );
}

// Ask the server whether the link is alive, ONCE per mount. Not again after a refused
// password: a 422 is about the password and leaves the link untouched, so re-checking would
// spend rate-limit budget on a question already answered (research D8).
function useLinkCheck(hash: string, token: string | null, setView: (view: ResetViewState) => void): void {
  // StrictMode mounts effects twice in development; one check per link value, like the
  // verification page's.
  const checkedFor = useRef('');

  useEffect(() => {
    if (token === null) {
      setView('dead');
      return;
    }
    if (checkedFor.current === hash + token) {
      return;
    }
    checkedFor.current = hash + token;
    PasswordApi.checkToken(hash, token).then((result) => setView(result.ok ? 'form' : 'dead'));
  }, [hash, token, setView]);
}

// Choose a new password from an emailed link (022, US2). The account is the LINK's, never
// the signed-in one, so the route is unguarded and the page never signs anyone in (FR-021).
//
// The fragment is read on every mount and deliberately never stripped: a history.replaceState
// tidying the address would turn a live link dead the moment its holder pressed Refresh, and
// the failure would be indistinguishable from expiry (research D3, FR-024).
function ResetPasswordPage() {
  const hash = useParams().hash ?? '';
  const token = PasswordModel.parseResetFragment(useLocation().hash);
  const [view, setView] = useState<ResetViewState>('checking');
  const [formError, setFormError] = useState('');
  const form = useAuthForm<ResetPasswordValues>(
    { password: '', passwordConfirmation: '' },
    PasswordModel.validateReset,
  );

  useLinkCheck(hash, token, setView);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    if (token === null || !form.startSubmit()) {
      return;
    }
    form.setSubmitting(true);
    const result = await PasswordApi.reset({ hash, token, ...form.values });
    form.setSubmitting(false);
    if (result.ok) {
      setView('done');
      return;
    }
    if (result.kind === 'validation') {
      form.setServerErrors(result.errors);
      return;
    }
    // Only a refused LINK ends the journey; a spent rate limit or a lost connection leaves
    // the link as good as it was, so the form stays where it is.
    if (result.kind === 'invalid') {
      setView('dead');
      return;
    }
    setFormError(PasswordModel.resetFailureMessage(result.kind));
  }

  return (
    <section className="auth">
      <h1>{view === 'form' ? 'Choose a new password' : 'Reset password'}</h1>
      {view === 'checking' ? <p className="auth-form__notice" role="status">Checking this link…</p> : null}
      {view === 'form' ? (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
          <fieldset disabled={form.submitting}>
            <AuthField
              id="password"
              label="New password"
              type="password"
              value={form.values.password}
              autoComplete="new-password"
              error={form.errors.password?.join('\n')}
              onChange={(value: string) => form.handleChange('password', value)}
              onBlur={() => form.handleBlur('password')}
            />
            <AuthField
              id="password-confirmation"
              label="Confirm new password"
              type="password"
              value={form.values.passwordConfirmation}
              autoComplete="new-password"
              error={form.errors.passwordConfirmation?.join('\n')}
              onChange={(value: string) => form.handleChange('passwordConfirmation', value)}
              onBlur={() => form.handleBlur('passwordConfirmation')}
            />
            <BusyButton type="submit" busy={form.submitting} disabled={form.hasErrors}>Set password</BusyButton>
          </fieldset>
        </form>
      ) : null}
      {view === 'done' || view === 'dead' ? <ResetOutcome view={view} /> : null}
    </section>
  );
}

export default ResetPasswordPage;
