import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for authenticated-only routes. While the initial session check is in flight
// (`unknown`) we render nothing rather than redirect, so a refresh of a protected page
// does not flash to /login before the session resolves (FR-012/FR-013).
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'unknown') {
    return null;
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default RequireAuth;
