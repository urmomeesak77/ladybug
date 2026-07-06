import type { ReactElement } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

type MenuGlyph = 'home' | 'person' | 'upload' | 'logout';

// Prototype-style flat glyphs on a 25x25 grid. House and person are copied verbatim
// from the prototype's LeftMenu; upload (arrow into tray) and logout (door + arrow)
// are drawn in the same style so the set reads as one family.
const GLYPHS: Record<MenuGlyph, ReactElement> = {
  home: (
    <g>
      <polygon points="3,14 13,5 22,14" />
      <polygon points="17,5 18,5 18,14 17,14" />
      <polygon points="5,25 5,14 20,14 20,25 18,25 18,18 12,18 12,25" />
    </g>
  ),
  person: (
    <g>
      <circle cx="13" cy="10" r="6" />
      <ellipse cx="13" cy="25" rx="12" ry="5" />
    </g>
  ),
  upload: (
    <g>
      <polygon points="13,3 20,11 16,11 16,17 10,17 10,11 6,11" />
      <polygon points="3,16 5,16 5,21 21,21 21,16 23,16 23,23 3,23" />
    </g>
  ),
  logout: (
    <g>
      <polygon points="4,3 14,3 14,8 12,8 12,5 6,5 6,20 12,20 12,17 14,17 14,22 4,22" />
      <polygon points="15,8 22,12 15,17 15,14 9,14 9,11 15,11" />
    </g>
  ),
};

// Decorative only: the adjacent link/button text is the accessible name (Principle IV).
function MenuIcon({ glyph }: { glyph: MenuGlyph }) {
  return (
    <svg className="left-menu-icon" viewBox="0 0 25 25" aria-hidden="true" focusable="false">
      <rect x="0" y="0" rx="5" ry="5" width="25" height="25" className="left-menu-icon-bg" />
      {GLYPHS[glyph]}
    </svg>
  );
}

// Prototype order: the login entry sits above Home for anonymous visitors.
function AnonymousLinks() {
  return (
    <>
      <li>
        <NavLink to="/login">
          <MenuIcon glyph="person" />
          Login/register
        </NavLink>
      </li>
      <li>
        <NavLink to="/" end>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
    </>
  );
}

function AuthenticatedLinks({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <li>
        <NavLink to="/" end>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
      <li>
        <NavLink to="/upload">
          <MenuIcon glyph="upload" />
          Upload
        </NavLink>
      </li>
      <li>
        <NavLink to="/account">
          <MenuIcon glyph="person" />
          Account
        </NavLink>
      </li>
      <li>
        <button type="button" className="left-menu__logout" onClick={onLogout}>
          <MenuIcon glyph="logout" />
          Log out
        </button>
      </li>
    </>
  );
}

// Primary navigation as the prototype's left menu, auth-aware (FR-011): anonymous
// visitors get a combined Login/register entry; authenticated visitors get Upload,
// Account and a working Log out control. `unknown` (session check in flight) renders
// as anonymous so authed-only items never flash.
function LeftMenu() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = status === 'authenticated' && user !== null;

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  return (
    <nav id="left-menu" aria-label="Primary">
      <ul>
        {isAuthenticated ? (
          <AuthenticatedLinks onLogout={() => void handleLogout()} />
        ) : (
          <AnonymousLinks />
        )}
      </ul>
    </nav>
  );
}

export default LeftMenu;
