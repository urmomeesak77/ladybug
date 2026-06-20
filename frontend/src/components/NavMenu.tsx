import { NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Primary navigation, auth-aware (FR-011): anonymous visitors get Login + Register links;
// authenticated visitors are greeted by name and get a working Log out control. `unknown`
// (session check in flight) is treated as not-yet-authenticated so authed-only items never
// flash. The Account link arrives with its page in US3.
function NavMenu() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = status === 'authenticated' && user !== null;

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  return (
    <nav aria-label="Primary">
      <ul>
        <li>
          <NavLink to="/" end>
            Home
          </NavLink>
        </li>
        {isAuthenticated ? (
          <>
            <li>
              <NavLink to="/account">Account</NavLink>
            </li>
            <li>
              <button type="button" className="nav-logout" onClick={() => void handleLogout()}>
                Log out
              </button>
            </li>
          </>
        ) : (
          <>
            <li>
              <NavLink to="/login">Login</NavLink>
            </li>
            <li>
              <NavLink to="/register">Register</NavLink>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
}

export default NavMenu;
