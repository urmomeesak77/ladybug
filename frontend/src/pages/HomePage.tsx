import { useEffect } from 'react';

import Feed from '../components/Feed';

// The Home/landing view: heading + the newest meme feed. Reading the `?after` page cursor
// from the URL is added in US2; this renders the newest page only.
function HomePage() {
  useEffect(() => {
    document.title = 'Ladybug — Latest memes';
  }, []);

  return (
    <section aria-labelledby="home-heading">
      <h1 id="home-heading">Latest memes</h1>
      <Feed />
    </section>
  );
}

export default HomePage;
