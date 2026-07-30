import { useState } from 'react';

import { GoogleAuth } from '../lib/googleAuth';

// Google's mark, inline. Not a remote image and not an icon font: a third-party asset
// on the sign-in page would be a dependency and a request to another origin for no gain
// (Principle I and VI). aria-hidden because the button's own text names the action —
// the mark would otherwise be read out twice.
function GoogleMark() {
  return (
    <svg className="google-button__mark" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

// The Google door, on both auth pages. A real <button> because it performs an action
// rather than navigating to a document — which also buys Enter and Space activation
// without a keydown handler.
//
// `redirectTo` is not optional plumbing: clicking this is a FULL-PAGE navigation to the
// backend, which destroys router state, so the path the visitor was headed for has to
// survive the round trip as ?redirect= (FR-006). Omit it and every Google sign-in
// silently lands on the feed instead.
//
// It renders unconditionally, never on backend configuration (research D12): an
// unconfigured deployment answers ?error=provider and the visitor sees a retryable
// message, which is a better failure than a control that is simply absent.
function GoogleSignInButton({ redirectTo }: { redirectTo?: string }) {
  const [pending, setPending] = useState(false);

  function handleClick(): void {
    if (pending) {
      return;
    }
    // Never cleared: the page is navigating away. If the navigation fails the visitor
    // still has Back and a working password form (US4 AS5).
    setPending(true);
    GoogleAuth.start(redirectTo);
  }

  return (
    <button
      type="button"
      className="google-button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={handleClick}
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}

export default GoogleSignInButton;
