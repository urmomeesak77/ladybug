import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuthForm } from '../hooks/useAuthForm';
import { PasswordApi } from '../lib/passwordApi';
import { PasswordModel } from '../lib/passwordModel';
import type { ResetPasswordValues } from '../lib/passwordModel';

// One address, five states, all restored by Back/Forward/Refresh (FR-024). `unavailable` is
// NOT a synonym for `dead`: the link is presumed alive and the visitor is asked to retry,
// because we could not reach an answer rather than because we got a refusal.
type ResetViewState = 'checking' | 'form' | 'dead' | 'done' | 'unavailable';

// The status line, mounted for the life of the page rather than swapped in when an outcome
// arrives. A live region has to be in the accessibility tree BEFORE its text changes; an
// element that appears already carrying its own role="status" is not reliably announced.
// Mirrors VerifyEmailPage, which keeps one node and changes only its words.
function statusTextFor(view: ResetViewState): string {
  if (view === 'checking') {
    return 'Checking this link…';
  }
  if (view === 'done') {
    return 'Your password has been changed. Please log in.';
  }
  if (view === 'dead') {
    return PasswordModel.resetFailureMessage('invalid');
  }
  return '';
}

// Ask the server whether the link is alive, ONCE per mount. Not again after a refused
// password: a 422 is about the password and leaves the link untouched, so re-checking would
// spend rate-limit budget on a question already answered (research D8).
function useLinkCheck(
  hash: string,
  token: string | null,
  attempt: number,
  setView: (view: ResetViewState) => void,
  setCheckError: (message: string) => void,
): void {
  // StrictMode mounts effects twice in development; one check per link value, like the
  // verification page's. `attempt` is part of the key so an explicit retry re-asks.
  const checkedFor = useRef('');

  useEffect(() => {
    if (token === null) {
      setView('dead');
      return;
    }
    const key = `${attempt}:${hash}${token}`;
    if (checkedFor.current === key) {
      return;
    }
    checkedFor.current = key;
    PasswordApi.checkToken(hash, token).then((result) => {
      if (result.ok) {
        setView('form');
        return;
      }
      // Only the server's 403 means the LINK is dead. A spent rate limit or a lost
      // connection says nothing about it — and calling those `dead` is actively harmful,
      // because the refusal offers "Request a new link", which SUPERSEDES the live link the
      // visitor is holding (FR-008). The `password` limiter is keyed by IP and shared with
      // the request form, so an impatient visitor on an office or CGNAT address trips it
      // routinely. Same split the submit handler below makes.
      if (result.kind === 'invalid') {
        setView('dead');
        return;
      }
      setCheckError(PasswordModel.resetFailureMessage(result.kind));
      setView('unavailable');
    });
  }, [hash, token, attempt, setView, setCheckError]);
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
  const [attempt, setAttempt] = useState(0);
  const [checkError, setCheckError] = useState('');
  const [formError, setFormError] = useState('');
  const form = useAuthForm<ResetPasswordValues>(
    { password: '', passwordConfirmation: '' },
    PasswordModel.validateReset,
  );

  useEffect(() => {
    document.title = 'Reset password';
  }, []);

  useLinkCheck(hash, token, attempt, setView, setCheckError);

  function retryCheck(): void {
    setCheckError('');
    setView('checking');
    setAttempt((previous) => previous + 1);
  }

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
      <p className="auth-form__notice" role="status">{statusTextFor(view)}</p>
      {view === 'unavailable' ? (
        <>
          <p className="auth-form__error" role="alert">{checkError}</p>
          <p className="auth-form__link">
            <button type="button" className="auth-form__retry" onClick={retryCheck}>Try again</button>
          </p>
        </>
      ) : null}
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
      {view === 'done' ? <p className="auth-form__link"><Link to="/login">Go to login</Link></p> : null}
      {view === 'dead' ? (
        <p className="auth-form__link"><Link to="/forgot-password">Request a new link</Link></p>
      ) : null}
    </section>
  );
}

export default ResetPasswordPage;
