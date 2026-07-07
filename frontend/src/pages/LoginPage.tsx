import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

const LOGIN_FIELDS = ['email', 'password'];

// Login form, prototype-style: fields validate on blur, the submit button is gated while
// client errors exist, and the whole fieldset is disabled during the request. A failed
// authentication (401) shows a single non-disclosing message — never revealing whether
// the email or the password was wrong (FR-003). Unexpected failures raise the app-level
// NoticeDialog. The password is never repopulated (FR-018).
function LoginPage() {
  const { login } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // Client (blur/submit) and server (422) errors are tracked apart so that revalidating
  // one field on blur never wipes out a server-reported error on another (server wins,
  // but only the touched-aware client pass may replace clientErrors).
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const errors = AuthModel.mergeServerErrors(clientErrors, serverErrors);

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setClientErrors(AuthModel.validateLogin({ email, password }, nextTouched));
  }

  // A field's server verdict no longer applies once its value changes.
  function clearServerError(field: string): void {
    setServerErrors(AuthModel.clearFieldError(serverErrors, field));
  }

  function handleEmailChange(value: string): void {
    setEmail(value);
    clearServerError('email');
  }

  function handlePasswordChange(value: string): void {
    setPassword(value);
    clearServerError('password');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    setTouched(new Set(LOGIN_FIELDS));
    const values = { email, password };
    const validationErrors = AuthModel.validateLogin(values);
    if (Object.keys(validationErrors).length > 0) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors({});
    setSubmitting(true);
    const result = await login(values);
    setSubmitting(false);
    if (result.ok) {
      // Return to the location the auth guard blocked, if any (D9) — e.g. a
      // verification link opened while signed out completes after login.
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from ?? '/');
      return;
    }
    if (result.kind === 'validation') {
      setClientErrors({});
      setServerErrors(result.errors);
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Email or password is incorrect.');
      return;
    }
    show({ message: 'Failed to log in. Please try again.' });
  }

  // Gates on client errors only: a lingering server error must not soft-lock the submit
  // button once the user has corrected the field client-side validates.
  const hasErrors = Object.keys(clientErrors).length > 0;

  return (
    <section className="auth">
      <h1>Log in</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <fieldset disabled={submitting}>
          <AuthField
            id="email"
            label="E-mail"
            type="email"
            value={email}
            autoComplete="email"
            error={errors.email?.join('\n')}
            onChange={handleEmailChange}
            onBlur={() => handleBlur('email')}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            error={errors.password?.join('\n')}
            onChange={handlePasswordChange}
            onBlur={() => handleBlur('password')}
          />
          <button type="submit" disabled={submitting || hasErrors}>Login</button>
        </fieldset>
        <p className="auth-form__link"><Link to="/register">No account? Register here....</Link></p>
      </form>
    </section>
  );
}

export default LoginPage;
