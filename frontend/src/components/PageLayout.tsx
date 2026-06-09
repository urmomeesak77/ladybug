import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import NavMenu from './NavMenu';

// Shared shell every route mounts inside: site wordmark header + primary nav, then the
// routed view in the <main> landmark. Landmarks (<header>/<nav>/<main>) give assistive
// tech a navigable page structure (Principle IV). The wordmark links home so it doubles
// as a logo-home affordance.
function PageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <Link to="/" className="site-wordmark">
          Ladybug
        </Link>
        <NavMenu />
      </header>
      <main>{children}</main>
    </>
  );
}

export default PageLayout;
