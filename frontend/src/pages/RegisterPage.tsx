import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useAuthForm } from '../hooks/useAuthForm';
import { useNotice } from '../hooks/useNotice';
import { AuthModel } from '../lib/authModel';

type RegisterValues = { name: string; email: string; password: string; passwordConfirmation: string };

type RegisterForm = ReturnType<typeof useAuthForm<RegisterValues>>;

// The field roster drives rendering, so adding a field is one row here — and keeps the
// components inside the 50-line budget (Principle II).
const FIELDS = [
  { id: 'name', name: 'name', label: 'Display name', type: 'text', autoComplete: 'name' },
  { id: 'email', name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { id: 'password', name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
  {
    id: 'password-confirmation',
    name: 'passwordConfirmation',
    label: 'Re-type password',
    type: 'password',
    autoComplete: 'new-password',
  },
] as const;

function RegisterFields({ form }: { form: RegisterForm }) {
  return (
    <>
      {FIELDS.map((field) => (
        <AuthField
          key={field.id}
          id={field.id}
          label={field.label}
          type={field.type}
          value={form.values[field.name]}
          autoComplete={field.autoComplete}
          error={form.errors[field.name]?.join('\n')}
          onChange={(value: string) => form.handleChange(field.name, value)}
          onBlur={() => form.handleBlur(field.name)}
        />
      ))}
    </>
  );
}

// Registration form, prototype-style: fields validate on blur, the submit button is
// gated while client errors exist, and the fieldset is disabled during the request.
// The server stays authoritative (422 field errors merge in, server wins). Success
// raises the app-level welcome dialog — it must outlive this page, because the
// auth-state flip makes RequireAnon redirect immediately. Passwords are never
// repopulated (FR-018).
function RegisterPage() {
  const { register } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const form = useAuthForm<RegisterValues>(
    { name: '', email: '', password: '', passwordConfirmation: '' },
    AuthModel.validateRegister,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.startSubmit()) {
      return;
    }
    form.setSubmitting(true);
    const result = await register(form.values);
    form.setSubmitting(false);
    if (result.ok) {
      // FR-007: steer the fresh registrant to the verification notice — the
      // account works, but the email must be confirmed to prove address control.
      show({ message: `Welcome, ${result.user.name}! Check your inbox to verify your e-mail.` });
      navigate('/verify-email');
      return;
    }
    if (result.kind === 'validation') {
      form.setServerErrors(result.errors);
      return;
    }
    show({ message: 'Failed to sign up. Please try again.' });
  }

  return (
    <section className="auth">
      <h1>Sign up</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={form.submitting}>
          <RegisterFields form={form} />
          <BusyButton type="submit" busy={form.submitting} disabled={form.hasErrors}>Register</BusyButton>
        </fieldset>
        <p className="auth-form__link"><Link to="/login">Already have an account? Login here....</Link></p>
      </form>
    </section>
  );
}

export default RegisterPage;
