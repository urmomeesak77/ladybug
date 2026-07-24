import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useNavDrawer } from '../hooks/useNavDrawer';
import LeftMenu from './LeftMenu';

// Three flat bars on the same 25x25 grid as LeftMenu's glyph set, so the toggle reads as part of
// that family. Decorative only: the button's aria-label is the accessible name (Principle IV).
function NavToggleIcon() {
  return (
    <svg className="nav-toggle-icon" viewBox="0 0 25 25" aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="21" height="3" rx="1" />
      <rect x="2" y="11" width="21" height="3" rx="1" />
      <rect x="2" y="17" width="21" height="3" rx="1" />
    </svg>
  );
}

// Shared shell every route mounts inside: a logo-only header (the prototype's
// top-menu), then a centered container holding the fixed left menu and the routed
// view in the <main> landmark. Landmarks (<header>/<nav>/<main>) give assistive tech
// a navigable page structure (Principle IV). The logo links home so it doubles as a
// logo-home affordance; <picture> swaps the logo art per color scheme so the wordmark
// stays legible in both themes (Principle IV); the <img> alt names the site.
//
// The toggle is the narrow-viewport escape hatch: below 50rem the CSS hides the rail entirely,
// which would leave primary navigation unreachable, so at those widths the button opens the same
// menu as an overlay drawer. It is the ARIA disclosure pattern — aria-expanded plus aria-controls
// on the trigger, and no menu roles, because the drawer's entries are ordinary links. CSS hides
// the button above the breakpoint, where the rail is visible anyway.
function PageLayout({ children }: { children: ReactNode }) {
  const { open, toggle, close, panelRef, triggerRef } = useNavDrawer();

  return (
    <>
      <header>
        <button
          type="button"
          className="nav-toggle"
          ref={triggerRef}
          onClick={toggle}
          aria-expanded={open}
          aria-controls="left-menu"
          aria-label="Menu"
        >
          <NavToggleIcon />
        </button>
        <Link to="/" className="site-logo">
          <picture>
            <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/logo-light.png" alt="online-trash home" />
          </picture>
        </Link>
      </header>
      <div className="main-container">
        <LeftMenu open={open} panelRef={panelRef} onNavigate={close} />
        {open ? <div className="nav-backdrop" aria-hidden="true" /> : null}
        <main>{children}</main>
      </div>
    </>
  );
}

export default PageLayout;
