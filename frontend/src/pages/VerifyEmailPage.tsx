import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';
import type { VerifyViewState } from '../lib/authModel';

// Link landing page (008): forwards the link's signed components to the API and
// renders the server-derived outcome. The API is idempotent, so refreshing this
// real URL re-verifies harmlessly and reproduces the same view (FR-005/FR-010).
function VerifyEmailPage() {
  const { hash } = useParams();
  const [searchParams] = useSearchParams();
  const { status, refresh } = useAuth();
  const { show } = useNotice();
  const [resending, setResending] = useState(false);
  // A structurally broken link can never validate, so the failure state is
  // derived up front and no doomed request is ever issued.
  const input = AuthModel.parseVerifyParams(hash, searchParams);
  const [view, setView] = useState<VerifyViewState>(input === null ? 'failed' : 'verifying');
  const [failureMessage, setFailureMessage] = useState(
    input === null ? AuthModel.verifyFailureMessage('invalid') : '',
  );

  // One request per link, even across StrictMode's duplicated mount effect: the API
  // is idempotent, but the duplicate's already_verified=true answer would overwrite
  // the fresh confirmation the user should see (seen live in e2e on the dev build).
  const requestedFor = useRef('');

  useEffect(() => {
    const parsed = AuthModel.parseVerifyParams(hash, searchParams);
    if (parsed === null) {
      return;
    }
    const link = `${parsed.hash}?${parsed.expires}&${parsed.signature}`;
    if (requestedFor.current === link) {
      return;
    }
    requestedFor.current = link;
    AuthApi.verifyEmail(parsed).then((result) => {
      setView(AuthModel.verifyViewState(result));
      if (!result.ok) {
        setFailureMessage(AuthModel.verifyFailureMessage(result.kind));
        return;
      }
      if (!result.alreadyVerified) {
        // Propagate the fresh emailVerifiedAt everywhere the SPA shows status.
        void refresh();
      }
    });
  }, [hash, searchParams, refresh]);

  async function handleResend(): Promise<void> {
    setResending(true);
    const result = await AuthApi.resendVerification();
    setResending(false);
    show({ message: AuthModel.resendFeedback(result) });
  }

  const statusText = {
    verifying: 'Verifying your e-mail…',
    confirmed: 'Your e-mail is verified.',
    already: 'Your e-mail was already verified.',
    failed: failureMessage,
  }[view];

  return (
    <section className="verify">
      <h1>E-mail verification</h1>
      {/* role=status implies aria-live=polite: outcome changes are announced. */}
      <p className="verify__status" role="status">{statusText}</p>
      {view === 'confirmed' || view === 'already'
        ? <p><Link to="/account">Go to your account</Link></p>
        : null}
      {view === 'failed' && status === 'authenticated'
        // FR-004: a dead link explains itself and offers the path to a new one.
        ? (
          <BusyButton className="verify__resend" busy={resending} onClick={() => void handleResend()}>
            Resend verification e-mail
          </BusyButton>
        )
        : null}
      {view === 'failed' && status === 'anonymous'
        // Resend needs a session (the API refuses anonymous resends), so a
        // signed-out visitor is pointed at login instead of a doomed button.
        ? <p><Link to="/login">Log in to request a new verification e-mail</Link></p>
        : null}
    </section>
  );
}

export default VerifyEmailPage;
