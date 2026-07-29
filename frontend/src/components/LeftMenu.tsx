import type { ReactElement, RefObject } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';
import { Role } from '../lib/role';

type MenuGlyph = 'home' | 'person' | 'upload' | 'logout' | 'moderation' | 'users' | 'games';

// The sister site the Games entry points at. Absolute because it leaves the SPA:
// a router link would resolve it against our own origin.
const GAMES_URL = 'https://games.online-trash.com';

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
  // Stacked rows: the moderation table, drawn in the same flat style as the set.
  moderation: (
    <g>
      <polygon points="3,4 22,4 22,8 3,8" />
      <polygon points="3,11 22,11 22,15 3,15" />
      <polygon points="3,18 22,18 22,22 3,22" />
    </g>
  ),
  // Two people: the account roster, drawn in the same flat style as the person glyph.
  users: (
    <g>
      <circle cx="9" cy="9" r="5" />
      <ellipse cx="9" cy="24" rx="9" ry="5" />
      <circle cx="19" cy="10" r="4" />
      <ellipse cx="20" cy="24" rx="7" ry="4" />
    </g>
  ),
  // Gamepad d-pad plus its two action buttons; the pad body is left out because the
  // glyph set is single-color solids, so an outlined body would need a cut-out.
  games: (
    <g>
      <polygon points="6,7 10,7 10,11 14,11 14,15 10,15 10,19 6,19 6,15 2,15 2,11 6,11" />
      <circle cx="19" cy="10" r="2.5" />
      <circle cx="19" cy="17" r="2.5" />
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

// Leaves the SPA, so it is a plain anchor rather than a NavLink: no client-side
// route to match, and nothing to mark as the current page. Shown to everyone.
function GamesLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <li>
      <a href={GAMES_URL} onClick={onNavigate}>
        <MenuIcon glyph="games" />
        Games
      </a>
    </li>
  );
}

// Home leads the menu for anonymous visitors too, so the entry point to the feed sits
// in the same first slot it occupies for authenticated ones.
function AnonymousLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <li>
        <NavLink to="/" end onClick={onNavigate}>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
      <li>
        <NavLink to="/login" onClick={onNavigate}>
          <MenuIcon glyph="person" />
          Login/register
        </NavLink>
      </li>
      <GamesLink onNavigate={onNavigate} />
    </>
  );
}

// Upload is verified-only (the API rejects unverified posts with 403); Moderation and Users
// are admin-only (the API gates both with role:admin). Hiding each entry keeps the menu honest
// about what the user can actually do right now.
function AuthenticatedLinks({
  showUpload,
  showModeration,
  showUsers,
  onLogout,
  onNavigate,
}: {
  showUpload: boolean;
  showModeration: boolean;
  showUsers: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <li>
        <NavLink to="/" end onClick={onNavigate}>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
      {showUpload ? (
        <li>
          <NavLink to="/upload" onClick={onNavigate}>
            <MenuIcon glyph="upload" />
            Upload
          </NavLink>
        </li>
      ) : null}
      {showModeration ? (
        <li>
          <NavLink to="/admin/trashposts" onClick={onNavigate}>
            <MenuIcon glyph="moderation" />
            Trashposts
          </NavLink>
        </li>
      ) : null}
      {showUsers ? (
        <li>
          <NavLink to="/admin/users" onClick={onNavigate}>
            <MenuIcon glyph="users" />
            Users
          </NavLink>
        </li>
      ) : null}
      <li>
        <NavLink to="/account" onClick={onNavigate}>
          <MenuIcon glyph="person" />
          Account
        </NavLink>
      </li>
      <GamesLink onNavigate={onNavigate} />
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
//
// The drawer props are how PageLayout drives the narrow-viewport overlay: `open` adds the
// class the `max-width: 50rem` rules turn into a floating panel, `panelRef` lets the drawer
// hook hit-test pointer-downs, and `onNavigate` fires on every entry so choosing one closes
// the drawer. All three are optional and inert above the breakpoint, where `open` is never true.
// `panelRef` must be supplied whenever `open` can become true: without it, the drawer hook's
// outside-pointer-down check has nothing to hit-test, so every pointer-down inside the open
// drawer reads as outside and closes it before a click on an entry can land.
function LeftMenu({ open = false, panelRef, onNavigate }: {
  open?: boolean;
  panelRef?: RefObject<HTMLElement>;
  onNavigate?: () => void;
}) {
  const { status, user, role, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = status === 'authenticated' && user !== null;
  const isAdmin = Role.rank(role) >= Role.rank('admin');

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
    onNavigate?.();
  }

  return (
    <nav
      id="left-menu"
      aria-label="Primary"
      ref={panelRef}
      className={open ? 'left-menu--open' : undefined}
    >
      <ul>
        {isAuthenticated ? (
          <AuthenticatedLinks
            showUpload={user.emailVerifiedAt !== null}
            showModeration={isAdmin}
            showUsers={isAdmin}
            onLogout={() => void handleLogout()}
            onNavigate={onNavigate}
          />
        ) : (
          <AnonymousLinks onNavigate={onNavigate} />
        )}
      </ul>
    </nav>
  );
}

export default LeftMenu;
