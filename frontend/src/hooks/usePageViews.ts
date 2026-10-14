import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { Analytics } from '../lib/analytics';
import type { AnalyticsHost } from '../lib/analytics';

// One sanitised page view per route the visitor lands on (Analytics explains what is
// stripped). Keyed on the pathname only: a query-only change such as the feed's "Load more"
// page break is the same page. The ref also absorbs StrictMode's doubled effect run, so a
// development build does not count every page twice.
export function usePageViews(): void {
  const { pathname } = useLocation();
  const previousLocation = useRef<string | null>(null);

  useEffect(() => {
    const origin = window.location.origin;
    const location = Analytics.pageLocation(origin, pathname);
    if (location === previousLocation.current) {
      return;
    }
    Analytics.trackPageView(window as unknown as AnalyticsHost, {
      location,
      path: Analytics.sanitisePath(pathname),
      referrer: previousLocation.current ?? Analytics.sanitiseReferrer(document.referrer, origin),
      title: document.title,
    });
    previousLocation.current = location;
  }, [pathname]);
}
