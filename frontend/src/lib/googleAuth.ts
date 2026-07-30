import { Api } from './api';

// The seven closed error codes the backend can hand back on ?error=, and the sentence
// each one shows. A closed map is what makes the parameter a display input only: the
// value is a lookup key and is never interpolated, so /login?error=<script> renders
// nothing but the generic sentence.
const MESSAGES: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  state: 'That sign-in attempt is no longer valid. Please try again.',
  unverified_email:
    'Google did not confirm an e-mail address for that account. Please use e-mail and password instead.',
  already_linked: 'That account is already connected to a different Google account.',
  // Byte-identical to the sentence LoginPage already shows for a disabled password
  // login — the same outcome at both front doors (SC-006).
  disabled: 'This account is disabled.',
  rate_limited: 'Too many sign-in attempts. Please wait a moment and try again.',
  provider: 'Google could not be reached. Please try again, or use e-mail and password.',
};

const START_PATH = '/api/auth/google/redirect';

// The SPA half of the Google sign-in flow: where to send the browser, and what to say
// when it comes back refused. Deliberately tiny and almost entirely pure — the round
// trip itself is the backend's, and this file adds no dependency to reach it.
export class GoogleAuth {
  // The backend start route as an ABSOLUTE url on the API origin. A relative path would
  // resolve against the SPA's own origin (the Vite dev server on :5173), which has no
  // such route — Api.base() is the one existing accessor for that origin.
  static startUrl(redirectTo?: string): string {
    const start = `${Api.base()}${START_PATH}`;
    if (!redirectTo) {
      return start;
    }
    // Encoded whole, so a path carrying its own ? or & cannot split the outer query.
    return `${start}?redirect=${encodeURIComponent(redirectTo)}`;
  }

  // Leave the SPA for the backend. A full-page navigation, not a router push: the flow
  // continues at Google and returns to a fresh document, so router state cannot survive
  // it — which is exactly why the intended path travels as ?redirect=.
  static start(redirectTo?: string): void {
    window.location.assign(GoogleAuth.startUrl(redirectTo));
  }

  // The sentence for an ?error= code: the mapped one, else the retryable fallback so a
  // code this build has not heard of never renders a blank alert. An absent code is not
  // an error at all — an ordinary visit to /login must raise nothing.
  static errorMessage(code?: string | null): string {
    if (!code) {
      return '';
    }
    return MESSAGES[code] ?? MESSAGES.provider;
  }
}
