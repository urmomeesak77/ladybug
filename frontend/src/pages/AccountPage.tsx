import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// The logged-in user's profile (name + email + verification status) plus a Log out
// control. Verification status is words in the details list — never color alone
// (FR-008, Principle IV) — and only an unverified account gets the resend action.
// RequireAuth gates the route, so a user is always present by the time this
// renders; the null guard only satisfies the type narrowing.
function AccountPage() {
  const { user, logout } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    navigate('/');
  }

  async function handleResend(): Promise<void> {
    setResending(true);
    const result = await AuthApi.resendVerification();
    setResending(false);
    show({ message: AuthModel.resendFeedback(result) });
  }

  if (!user) {
    return null;
  }

  return (
    <section className="account">
      <h1>Your account</h1>
      <dl className="account__details">
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Email verification</dt>
        <dd>{user.emailVerifiedAt === null ? 'Not verified' : 'Verified'}</dd>
        {/* 017/FR-029: which doors this account has, in words. Also the only notice
            the owner gets that a Google account was auto-linked to theirs (US3). */}
        <dt>Sign-in method</dt>
        <dd>{AuthModel.signInMethod(user)}</dd>
      </dl>
      {user.emailVerifiedAt === null
        ? (
          <BusyButton className="account__resend" busy={resending} onClick={() => void handleResend()}>
            Resend verification e-mail
          </BusyButton>
        )
        : null}
      <BusyButton className="account__logout" busy={loggingOut} onClick={() => void handleLogout()}>
        Log out
      </BusyButton>
    </section>
  );
}

export default AccountPage;
