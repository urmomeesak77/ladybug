import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

const REGISTER_FIELDS = ['name', 'email', 'password', 'passwordConfirmation'];

// Registration form, prototype-style: fields validate on blur, the submit button is gated
// while client errors exist, and the fieldset is disabled during the request. The server
// stays authoritative and its 422 field errors are merged in (server wins). Success raises
// the app-level welcome dialog — it must outlive this page, because the auth-state flip
// makes RequireAnon redirect home immediately. Passwords are never repopulated (FR-018).
function RegisterPage() {
  const { register } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // Client (blur/submit) and server (422) errors are tracked apart so that revalidating
  // one field on blur never wipes out a server-reported error on another (server wins,
  // but only the touched-aware client pass may replace clientErrors).
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const errors = AuthModel.mergeServerErrors(clientErrors, serverErrors);

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    const values = { name, email, password, passwordConfirmation };
    setClientErrors(AuthModel.validateRegister(values, nextTouched));
  }

  // A field's server verdict no longer applies once its value changes.
  function clearServerError(field: string): void {
    setServerErrors(AuthModel.clearFieldError(serverErrors, field));
  }

  function handleNameChange(value: string): void {
    setName(value);
    clearServerError('name');
  }

  function handleEmailChange(value: string): void {
    setEmail(value);
    clearServerError('email');
  }

  function handlePasswordChange(value: string): void {
    setPassword(value);
    clearServerError('password');
  }

  function handlePasswordConfirmationChange(value: string): void {
    setPasswordConfirmation(value);
    clearServerError('passwordConfirmation');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched(new Set(REGISTER_FIELDS));
    const values = { name, email, password, passwordConfirmation };
    const validationErrors = AuthModel.validateRegister(values);
    if (Object.keys(validationErrors).length > 0) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors({});
    setSubmitting(true);
    const result = await register(values);
    setSubmitting(false);
    if (result.ok) {
      show({ message: `Welcome, ${result.user.name}! Your account is ready.` });
      navigate('/');
      return;
    }
    if (result.kind === 'validation') {
      setClientErrors({});
      setServerErrors(result.errors);
      return;
    }
    show({ message: 'Failed to sign up. Please try again.' });
  }

  // Gates on client errors only: a lingering server error must not soft-lock the submit
  // button once the user has corrected the field client-side validates.
  const hasErrors = Object.keys(clientErrors).length > 0;

  return (
    <section className="auth">
      <h1>Sign up</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={submitting}>
          <AuthField
            id="name"
            label="Display name"
            type="text"
            value={name}
            autoComplete="name"
            error={errors.name?.join('\n')}
            onChange={handleNameChange}
            onBlur={() => handleBlur('name')}
          />
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
            autoComplete="new-password"
            error={errors.password?.join('\n')}
            onChange={handlePasswordChange}
            onBlur={() => handleBlur('password')}
          />
          <AuthField
            id="password-confirmation"
            label="Re-type password"
            type="password"
            value={passwordConfirmation}
            autoComplete="new-password"
            error={errors.passwordConfirmation?.join('\n')}
            onChange={handlePasswordConfirmationChange}
            onBlur={() => handleBlur('passwordConfirmation')}
          />
          <button type="submit" disabled={submitting || hasErrors}>Register</button>
        </fieldset>
        <p className="auth-form__link"><Link to="/login">Already have an account? Login here....</Link></p>
      </form>
    </section>
  );
}

export default RegisterPage;
