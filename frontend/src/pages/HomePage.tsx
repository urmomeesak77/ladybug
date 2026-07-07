import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import Feed from '../components/Feed';
import { Pagination } from '../lib/pagination';

// The Home/landing view: heading + the newest meme feed. The `?after` page cursor in the
// URL selects which feed page to show, so the view is bookmarkable and refresh-safe (US2).
function HomePage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const after = Pagination.pageStart(searchParams.get('after'));

  useEffect(() => {
    document.title = 'online-trash';
  }, []);

  return (
    <section aria-label="Memes">
      {/* Remount the feed on every navigation (location.key changes even when the URL
          does not) so clicking Home while already on the feed still resets it; the
          feed itself decides fresh-vs-restore from the navigation type. */}
      <Feed key={location.key} after={after} />
    </section>
  );
}

export default HomePage;
