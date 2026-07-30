import GoogleSignInButton from './GoogleSignInButton';

// The alternative sign-in door beneath the password form, on both auth pages (017).
//
// The separation is the WORD "or" (FR-026), not a rule: a styled divider distinguishes
// the two methods by appearance alone, which a screen-reader user never receives. The
// hairlines the CSS draws beside the label are decoration — remove them and the row
// still says what it means.
//
// `redirectTo` reaches this only from /login: RequireAuth is the one thing in the SPA
// that plants a blocked destination in router state, and it plants it there. A sign-up
// through Google has nowhere to return to but the feed.
function AuthAlt({ redirectTo }: { redirectTo?: string }) {
  return (
    <div className="auth-alt">
      <span className="auth-alt__label">or</span>
      <GoogleSignInButton redirectTo={redirectTo} />
    </div>
  );
}

export default AuthAlt;
