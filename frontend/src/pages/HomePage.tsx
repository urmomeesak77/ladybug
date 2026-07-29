import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import Feed from '../components/Feed';
import { useAuth } from '../hooks/useAuth';
import { Pagination } from '../lib/pagination';
import { Role } from '../lib/role';

// The Home/landing view: heading + the newest meme feed. The `?after` page cursor in the
// URL selects which feed page to show, so the view is bookmarkable and refresh-safe (US2).
function HomePage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { role } = useAuth();
  // Admin+ viewers get the in-place moderation kebab on every feed item (the server still
  // enforces access on the actions themselves).
  const canModerate = Role.rank(role) >= Role.rank('admin');
  const after = Pagination.pageStart(searchParams.get('after'));

  useEffect(() => {
    document.title = 'online-trash';
  }, []);

  return (
    <section aria-label="Memes">
      {/* The page's one top-level heading. Deliberately visible rather than sr-only: a
          screen-reader-only h1 satisfies a structure checker while leaving the page
          looking unlabelled, which helps nobody (research D13). FeedItem titles sit at
          h2 below it, so the outline has no skipped level. */}
      <h1 className="feed__heading">Newest memes</h1>
      {/* Remount the feed on every navigation (location.key changes even when the URL
          does not) so clicking Home while already on the feed still resets it; the
          feed itself decides fresh-vs-restore from the navigation type. */}
      <Feed key={location.key} after={after} canModerate={canModerate} />
    </section>
  );
}

export default HomePage;
