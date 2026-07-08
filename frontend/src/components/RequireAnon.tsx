import { useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for anonymous-only routes (login/register). Authenticated users are sent home;
// `unknown` renders nothing until the session check resolves, avoiding a flash (FR-012).
function RequireAnon({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  // Latch (render-time state adjustment, per the React docs pattern): once the form
  // was shown to an anonymous visitor, an auth flip means login/register succeeded
  // HERE and the page navigates itself (register → /verify-email, login → the
  // blocked location). A guard redirect would race that navigation — and won in
  // live e2e — so the guard only redirects visitors who arrive already signed in.
  const [sawAnonymous, setSawAnonymous] = useState(false);
  if (status === 'anonymous' && !sawAnonymous) {
    setSawAnonymous(true);
  }
  if (status === 'unknown') {
    return null;
  }
  if (status === 'authenticated' && !sawAnonymous) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default RequireAnon;
