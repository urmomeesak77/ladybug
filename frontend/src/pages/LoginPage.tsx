import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';

import AuthAlt from '../components/AuthAlt';
import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useAuthForm } from '../hooks/useAuthForm';
import { useGoogleRefusal } from '../hooks/useGoogleRefusal';
import { useNotice } from '../hooks/useNotice';
import { AuthModel } from '../lib/authModel';

type LoginValues = { email: string; password: string };

type LoginForm = ReturnType<typeof useAuthForm<LoginValues>>;

// The field roster drives rendering, so adding a field is one row here — and keeps the
// components inside the 50-line budget (Principle II).
const FIELDS = [
  { id: 'email', name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { id: 'password', name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
] as const;

function LoginFields({ form }: { form: LoginForm }) {
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
  const [formError, setFormError] = useState('');
  // Never pre-filled from a prior visit (spec Assumption/Edge Case) — plain local state
  // that resets on every mount, kept outside useAuthForm since that hook is typed over
  // string-valued fields only (research D5).
  const [remember, setRemember] = useState(false);
  // This form's own last failure, or the refusal a Google round trip returned with.
  const refusal = useGoogleRefusal(formError);
  const form = useAuthForm<LoginValues>({ email: '', password: '' }, AuthModel.validateLogin);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    if (!form.startSubmit()) {
      return;
    }
    form.setSubmitting(true);
    const result = await login({ ...form.values, remember });
    form.setSubmitting(false);
    if (result.ok) {
      // Return to the location the auth guard blocked, if any (D9) — e.g. an
      // account page opened while signed out is reached after login.
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from ?? '/');
      return;
    }
    if (result.kind === 'validation') {
      form.setServerErrors(result.errors);
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Email or password is incorrect.');
      return;
    }
    // A disabled account: the owner proved their credentials, so tell them plainly why they
    // cannot get in — distinct from the wrong-credentials message (FR-013).
    if (result.kind === 'disabled') {
      setFormError('This account is disabled.');
      return;
    }
    show({ message: 'Failed to log in. Please try again.' });
  }

  return (
    <section className="auth">
      <h1>Log in</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {refusal ? <p className="auth-form__error" role="alert">{refusal}</p> : null}
        <fieldset disabled={form.submitting}>
          <LoginFields form={form} />
          <div className="auth-checkbox">
            <input
              id="remember"
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <label htmlFor="remember">Remember me</label>
          </div>
          <BusyButton type="submit" busy={form.submitting} disabled={form.hasErrors}>Login</BusyButton>
        </fieldset>
        {/* The only entry point to recovery (022, FR-001), and it belongs here: someone
            who cannot get in is already on the page where they found that out. */}
        <p className="auth-form__link"><Link to="/forgot-password">Forgot password?</Link></p>
        <p className="auth-form__link"><Link to="/register">No account? Register here....</Link></p>
      </form>
      {/* The same location.state.from the password path reads above. Clicking is a
          full-page navigation, which destroys router state, so the blocked destination
          has to make the round trip as ?redirect= (FR-006). */}
      <AuthAlt redirectTo={(location.state as { from?: Location } | null)?.from?.pathname} />
    </section>
  );
}

export default LoginPage;
