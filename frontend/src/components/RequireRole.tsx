import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';
import { Role } from '../lib/role';
import type { RoleName } from '../lib/role';

// Min-role route gate (010): admits the viewer only when their effective role ranks at
// or above `role` (the UX mirror of the server's role:admin boundary — the API still
// enforces access on the data). While the initial session check is in flight (`unknown`)
// we render nothing rather than redirect, so refreshing a gated page does not flash Home
// before the role resolves (mirrors RequireAuth). Under-ranked viewers go Home with
// `replace`, so Back does not bounce through the gate.
function RequireRole({ role, children }: { role: RoleName; children: ReactNode }) {
  const { status, role: current } = useAuth();
  if (status === 'unknown') {
    return null;
  }
  if (Role.rank(current) < Role.rank(role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default RequireRole;
