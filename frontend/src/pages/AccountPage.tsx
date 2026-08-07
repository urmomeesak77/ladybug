import { useState } from 'react';

import AccountNameForm from '../components/AccountNameForm';
import AccountPasswordForm from '../components/AccountPasswordForm';
import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// The logged-in user's profile: an editable display name plus email and verification
// status. Verification status is words in the details list — never color alone
// (FR-008, Principle IV) — and only an unverified account gets the resend action.
// Logging out lives in the left menu, which is on every page, so it is not repeated here.
// RequireAuth gates the route, so a user is always present by the time this
// renders; the null guard only satisfies the type narrowing.
function AccountPage() {
  const { user } = useAuth();
  const { show } = useNotice();
  const [resending, setResending] = useState(false);

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
      <AccountNameForm name={user.name} />
      {/* 022/FR-025: the deliberate half of password management, on the page the owner
          already has — no new address and no new guard. Its state is its own: neither
          section can clear or block the other. */}
      <AccountPasswordForm hasPassword={user.hasPassword} />
      <dl className="account__details">
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
    </section>
  );
}

export default AccountPage;
