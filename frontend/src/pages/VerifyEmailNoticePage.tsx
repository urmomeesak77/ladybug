import { Link } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Post-registration notice (FR-007): tells the signed-in user where their
// verification link went. Status is stated in text, never by color alone
// (Principle IV). RequireAuth gates the route, so the null guard only
// satisfies type narrowing. The resend button arrives with US2.
function VerifyEmailNoticePage() {
  const { user } = useAuth();

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
    </section>
  );
}

export default VerifyEmailNoticePage;
