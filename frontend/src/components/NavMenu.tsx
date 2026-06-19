import { NavLink } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Primary navigation, auth-aware (FR-011): anonymous visitors get the register/login
// affordance; authenticated visitors are greeted by name. `unknown` (session check in
// flight) is treated as not-yet-authenticated so authed-only items never flash.
// The login route and the account/logout affordances arrive in US2/US3; until then the
// entry link points at /register, the one auth page that exists.
function NavMenu() {
  const { status, user } = useAuth();
  const isAuthenticated = status === 'authenticated' && user !== null;

  return (
    <nav aria-label="Primary">
      <ul>
        <li>
          <NavLink to="/" end>
            Home
          </NavLink>
        </li>
        {isAuthenticated ? (
          <li>
            <span className="nav-user">Hi, {user.name}</span>
          </li>
        ) : (
          <li>
            <NavLink to="/register">Login/register</NavLink>
          </li>
        )}
      </ul>
    </nav>
  );
}

export default NavMenu;
