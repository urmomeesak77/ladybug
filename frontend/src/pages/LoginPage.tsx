import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setErrors(AuthModel.validateLogin({ email, password }, nextTouched));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched(new Set(LOGIN_FIELDS));
    const values = { email, password };
    const clientErrors = AuthModel.validateLogin(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = await login(values);
    setSubmitting(false);
    if (result.ok) {
      navigate('/');
      return;
    }
    if (result.kind === 'validation') {
      setErrors(AuthModel.mergeServerErrors({}, result.errors));
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Email or password is incorrect.');
      return;
    }
    show({ message: 'Failed to log in. Please try again.' });
  }

  const hasErrors = Object.keys(errors).length > 0;

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
            onChange={setEmail}
            onBlur={() => handleBlur('email')}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            error={errors.password?.join('\n')}
            onChange={setPassword}
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
