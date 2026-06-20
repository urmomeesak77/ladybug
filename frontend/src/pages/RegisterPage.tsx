import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import { useAuth } from '../hooks/useAuth';
import type { FieldErrors } from '../lib/authApi';
import { mergeServerErrors, validateRegister } from '../lib/authModel';

// Registration form. Client validation gives instant feedback; the server stays
// authoritative and its 422 field errors are merged in (server wins). On success the
// AuthProvider flips to authenticated and we navigate home. Passwords are never
// repopulated and the submit control is guarded while a request is in flight (FR-009/18/19).
function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = { name, email, password, passwordConfirmation };
    const clientErrors = validateRegister(values);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = await register(values);
    setSubmitting(false);
    if (result.ok) {
      navigate('/');
      return;
    }
    if (result.kind === 'validation') {
      setErrors(mergeServerErrors({}, result.errors));
      return;
    }
    setFormError('Something went wrong. Please try again.');
  }

  return (
    <section className="auth">
      <h1>Create an account</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <AuthField id="name" label="Name" type="text" value={name} autoComplete="name" error={errors.name?.[0]} onChange={setName} />
        <AuthField id="email" label="Email" type="email" value={email} autoComplete="email" error={errors.email?.[0]} onChange={setEmail} />
        <AuthField id="password" label="Password" type="password" value={password} autoComplete="new-password" error={errors.password?.[0]} onChange={setPassword} />
        <AuthField id="password-confirmation" label="Confirm password" type="password" value={passwordConfirmation} autoComplete="new-password" error={errors.passwordConfirmation?.[0]} onChange={setPasswordConfirmation} />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>
    </section>
  );
}

export default RegisterPage;
