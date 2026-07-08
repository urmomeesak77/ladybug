import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for authenticated-only routes. While the initial session check is in flight
// (`unknown`) we render nothing rather than redirect, so a refresh of a protected page
// does not flash to /login before the session resolves (FR-012/FR-013).
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'unknown') {
    return null;
  }
  if (status === 'anonymous') {
    // Carry the blocked location in router state so login can return to it
    // after the sign-in (D9).
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

export default RequireAuth;
