import { useState } from 'react';
import { Link } from 'react-router-dom';

import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// Post-registration notice (FR-007): tells the signed-in user where their
// verification link went and offers a fresh message (US2, FR-006). Status is
// stated in text, never by color alone (Principle IV). RequireAuth gates the
// route, so the null guard only satisfies type narrowing.
function VerifyEmailNoticePage() {
  const { user } = useAuth();
  const { show } = useNotice();
  const [resending, setResending] = useState(false);

  async function handleResend(): Promise<void> {
    setResending(true);
    const result = await AuthApi.resendVerification();
    setResending(false);
    // The app-level dialog announces the outcome (it is an aria-modal alert).
    show({ message: AuthModel.resendFeedback(result) });
  }

  if (!user) {
    return null;
  }

  // Visiting the notice URL after verifying must not mislead (FR-010).
  if (user.emailVerifiedAt !== null) {
    return (
      <section className="verify">
        <h1>Verify your e-mail</h1>
        <p className="verify__status" role="status">Your e-mail is already verified.</p>
        <p><Link to="/account">Go to your account</Link></p>
      </section>
    );
  }

  return (
    <section className="verify">
      <h1>Verify your e-mail</h1>
      <p className="verify__notice">
        We sent a verification link to <strong>{user.email}</strong>.
        Check your inbox and open the link to verify your account.
      </p>
      <BusyButton className="verify__resend" busy={resending} onClick={() => void handleResend()}>
        Resend verification e-mail
      </BusyButton>
    </section>
  );
}

export default VerifyEmailNoticePage;
