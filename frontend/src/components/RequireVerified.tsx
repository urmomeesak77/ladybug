import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for verified-only routes (the upload form). Composed inside RequireAuth, so the
// session is already resolved and authenticated; the null guard only satisfies type
// narrowing. Unverified users land on the notice page, which explains the situation
// and offers the resend action — `replace` so Back does not bounce through the gate.
function RequireVerified({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  if (user.emailVerifiedAt === null) {
    return <Navigate to="/verify-email" replace />;
  }
  return <>{children}</>;
}

export default RequireVerified;
