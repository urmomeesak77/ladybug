import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import NavMenu from './NavMenu';

// Shared shell every route mounts inside: site logo header + primary nav, then the
// routed view in the <main> landmark. Landmarks (<header>/<nav>/<main>) give assistive
// tech a navigable page structure (Principle IV). The logo links home so it doubles
// as a logo-home affordance. <picture> swaps the logo art per color scheme so the
// wordmark stays legible in both themes (Principle IV); the <img> alt names the site.
function PageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <Link to="/" className="site-logo">
          <picture>
            <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/logo-light.png" alt="online-trash home" />
          </picture>
        </Link>
        <NavMenu />
      </header>
      <main>{children}</main>
    </>
  );
}

export default PageLayout;
