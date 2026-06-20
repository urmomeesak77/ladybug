import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for anonymous-only routes (login/register). Authenticated users are sent home;
// `unknown` renders nothing until the session check resolves, avoiding a flash (FR-012).
function RequireAnon({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'unknown') {
    return null;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default RequireAnon;
