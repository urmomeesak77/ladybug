import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from '../hooks/useNotice';
import { AuthApi } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';
import type { VerifyViewState } from '../lib/authModel';

function statusTextFor(view: VerifyViewState, failureMessage: string): string {
  return {
    verifying: 'Verifying your e-mail…',
    confirmed: 'Your e-mail is verified.',
    already: 'Your e-mail was already verified.',
    failed: failureMessage,
  }[view];
}

// The post-outcome affordances: account link on success; on failure, resend for a
// signed-in user (FR-004) or a login pointer for a signed-out one (the API refuses
// anonymous resends).
function VerifyOutcome({ view, status, resending, onResend }: {
  view: VerifyViewState;
  status: string;
  resending: boolean;
  onResend: () => void;
}) {
  if (view === 'confirmed' || view === 'already') {
    return <p><Link to="/account">Go to your account</Link></p>;
  }
  if (view !== 'failed') {
    return null;
  }
  if (status === 'authenticated') {
    return (
      <BusyButton className="verify__resend" busy={resending} onClick={onResend}>
        Resend verification e-mail
      </BusyButton>
    );
  }
  return <p><Link to="/login">Log in to request a new verification e-mail</Link></p>;
}

// Fulfills a verification link once per link value, even across StrictMode's duplicated
// mount effect: the API is idempotent, but the duplicate's already_verified=true answer
// would overwrite the fresh confirmation the user should see (seen live in e2e on the dev
// build). Its own hook keeps VerifyEmailPage inside the 50-line budget (Principle II).
function useVerifyOnMount(
  hash: string | undefined,
  searchParams: URLSearchParams,
  refresh: () => Promise<void>,
  setView: (view: VerifyViewState) => void,
  setFailureMessage: (message: string) => void,
): void {
  // One request per link value across the duplicated mount effect (see the hook comment).
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
  }, [hash, searchParams, refresh, setView, setFailureMessage]);
}

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

  useVerifyOnMount(hash, searchParams, refresh, setView, setFailureMessage);

  async function handleResend(): Promise<void> {
    setResending(true);
    const result = await AuthApi.resendVerification();
    setResending(false);
    show({ message: AuthModel.resendFeedback(result) });
  }

  return (
    <section className="verify">
      <h1>E-mail verification</h1>
      {/* role=status implies aria-live=polite: outcome changes are announced. */}
      <p className="verify__status" role="status">{statusTextFor(view, failureMessage)}</p>
      <VerifyOutcome view={view} status={status} resending={resending} onResend={() => void handleResend()} />
    </section>
  );
}

export default VerifyEmailPage;
