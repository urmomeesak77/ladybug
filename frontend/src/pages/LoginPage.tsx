import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import type { FieldErrors } from '../lib/authApi';
import { mergeServerErrors, validateLogin } from '../lib/authModel';

// Login form. Client validation gates obvious mistakes; the server is authoritative.
// A failed authentication (401) shows a single non-disclosing message — never revealing
// whether the email or the password was wrong (FR-003). On success the AuthProvider flips
// to authenticated and we navigate home. The password is never repopulated (FR-018) and
// the submit control is guarded while a request is in flight (FR-019).
function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = { email, password };
    const clientErrors = validateLogin(values);
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
      setErrors(mergeServerErrors({}, result.errors));
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Email or password is incorrect.');
      return;
    }
    setFormError('Something went wrong. Please try again.');
  }

  return (
    <section className="auth">
      <h1>Log in</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <AuthField id="email" label="Email" type="email" value={email} autoComplete="email" error={errors.email?.[0]} onChange={setEmail} />
        <AuthField id="password" label="Password" type="password" value={password} autoComplete="current-password" error={errors.password?.[0]} onChange={setPassword} />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </section>
  );
}

export default LoginPage;
