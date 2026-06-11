import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import Feed from '../components/Feed';
import { pageStart } from '../lib/pagination';

// The Home/landing view: heading + the newest meme feed. The `?after` page cursor in the
// URL selects which feed page to show, so the view is bookmarkable and refresh-safe (US2).
function HomePage() {
  const [searchParams] = useSearchParams();
  const after = pageStart(searchParams.get('after'));

  useEffect(() => {
    document.title = 'online-trash';
  }, []);

  return (
    <section aria-label="Memes">
      {/* Remount the feed when the page cursor changes so each page loads fresh, not
          appended to the previous page (US2 page break / Back-Forward). */}
      <Feed key={after ?? 'newest'} after={after} />
    </section>
  );
}

export default HomePage;
