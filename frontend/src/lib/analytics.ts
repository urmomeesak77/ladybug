// The gtag() global index.html defines; absent when the tag is blocked or not configured.
export type AnalyticsHost = { gtag?: (...args: unknown[]) => void };

export type PageView = { location: string; path: string; referrer: string; title: string };

// Routes whose second segment is an emailed link's secret-bearing part: an unsalted sha1 of
// the account's address (022, 008). Mirrors the `:hash` routes in App.tsx.
const SECRET_ROUTES = /^\/(reset-password|verify-email)\/[^/]+\/?$/;

// What Google Analytics is allowed to learn about a page. index.html configures gtag with
// send_page_view: false, so the page views it would otherwise send from the raw address —
// path digest, `?expires&signature` query and `#token=` fragment included — never happen;
// every page view goes through here instead, built from a pathname alone.
export class Analytics {
  static sanitisePath(pathname: string): string {
    const match = pathname.match(SECRET_ROUTES);
    return match ? `/${match[1]}/:hash` : pathname;
  }

  static pageLocation(origin: string, pathname: string): string {
    return `${origin}${Analytics.sanitisePath(pathname)}`;
  }

  // Our own pages as a referrer get the same treatment as a location; anyone else's are cut
  // to their origin, since a webmail referrer path can identify a mailbox or a message.
  static sanitiseReferrer(referrer: string, origin: string): string {
    let url: URL;
    try {
      url = new URL(referrer);
    } catch {
      return '';
    }
    if (url.origin !== origin) {
      return `${url.origin}/`;
    }
    return Analytics.pageLocation(origin, url.pathname);
  }

  // `set` first so any event gtag sends on its own afterwards (enhanced measurement) also
  // carries the sanitised location instead of reading document.location itself.
  static trackPageView(host: AnalyticsHost, view: PageView): void {
    if (typeof host.gtag !== 'function') {
      return;
    }
    const params = {
      page_location: view.location,
      page_path: view.path,
      page_referrer: view.referrer,
      page_title: view.title,
    };
    host.gtag('set', params);
    host.gtag('event', 'page_view', params);
  }
}
