import type { FeedPost } from './feedModel';

export type PostPageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; post: FeedPost }
  | { status: 'notFound' }
  | { status: 'error' };

export type PostPageAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; post: FeedPost }
  | { type: 'loadNotFound' }
  | { type: 'loadError' };

export const initialPostPageState: PostPageState = { status: 'idle' };

// The site name shown in the tab; matches the static <title> in index.html.
const SITE_NAME = 'online-trash';

// Pure page-lifecycle reducer. Two invariants matter: notFound/error are reachable only
// from a completed response (so not-found can never flash while loading), and loadStart
// always returns to a clean `loading` — dropping a previous post on hash change and
// clearing stale error text on retry (FR-006, FR-007, SC-008).
export function postPageReducer(state: PostPageState, action: PostPageAction): PostPageState {
  if (action.type === 'loadStart') {
    return { status: 'loading' };
  }
  if (state.status === 'idle') {
    // No request is in flight before the first loadStart; stray results are no-ops.
    return state;
  }
  if (action.type === 'loadSuccess') {
    return { status: 'loaded', post: action.post };
  }
  if (action.type === 'loadNotFound') {
    return { status: 'notFound' };
  }
  return { status: 'error' };
}

// "{title} - online-trash" for a meaningful title, plain site name otherwise (FR-009).
export function formatDocumentTitle(title: string | null): string {
  if (!title || title.trim() === '') {
    return SITE_NAME;
  }
  return `${title} - ${SITE_NAME}`;
}
