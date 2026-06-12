import { describe, expect, it } from 'vitest';

import { formatDocumentTitle, initialPostPageState, postPageReducer } from '../../src/lib/postModel';
import type { PostPageAction, PostPageState } from '../../src/lib/postModel';
import type { FeedPost } from '../../src/lib/feedModel';

const post: FeedPost = {
  hash: 'abc1234567',
  title: 'Hi',
  permalink: '/posts/abc1234567',
  media: { kind: 'none' },
};

const otherPost: FeedPost = {
  hash: 'xyz7654321',
  title: 'Other',
  permalink: '/posts/xyz7654321',
  media: { kind: 'none' },
};

const loadStart: PostPageAction = { type: 'loadStart' };
const loadSuccess: PostPageAction = { type: 'loadSuccess', post };
const loadNotFound: PostPageAction = { type: 'loadNotFound' };
const loadError: PostPageAction = { type: 'loadError' };

describe('initialPostPageState', () => {
  it('starts idle', () => {
    expect(initialPostPageState).toEqual({ status: 'idle' });
  });
});

describe('postPageReducer', () => {
  describe('from idle', () => {
    const idle: PostPageState = { status: 'idle' };

    it('loadStart begins loading', () => {
      expect(postPageReducer(idle, loadStart)).toEqual({ status: 'loading' });
    });

    it('ignores results that arrive before any load started', () => {
      // No request is in flight while idle, so result actions are no-ops.
      expect(postPageReducer(idle, loadSuccess)).toEqual(idle);
      expect(postPageReducer(idle, loadNotFound)).toEqual(idle);
      expect(postPageReducer(idle, loadError)).toEqual(idle);
    });
  });

  describe('from loading', () => {
    const loading: PostPageState = { status: 'loading' };

    it('loadStart stays loading', () => {
      expect(postPageReducer(loading, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(postPageReducer(loading, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound presents not-found', () => {
      expect(postPageReducer(loading, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(postPageReducer(loading, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from loaded', () => {
    const loaded: PostPageState = { status: 'loaded', post };

    it('loadStart drops the previous post and returns to loading', () => {
      // Hash change: the old meme must never bleed into the next view.
      expect(postPageReducer(loaded, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess replaces the post (latest result wins)', () => {
      expect(postPageReducer(loaded, { type: 'loadSuccess', post: otherPost }))
        .toEqual({ status: 'loaded', post: otherPost });
    });

    it('loadNotFound presents not-found', () => {
      expect(postPageReducer(loaded, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(postPageReducer(loaded, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from notFound', () => {
    const notFound: PostPageState = { status: 'notFound' };

    it('loadStart starts a fresh load (notFound is never sticky)', () => {
      expect(postPageReducer(notFound, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(postPageReducer(notFound, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound stays notFound', () => {
      expect(postPageReducer(notFound, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(postPageReducer(notFound, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from error', () => {
    const errorState: PostPageState = { status: 'error' };

    it('loadStart (retry) clears the stale error before the new result lands', () => {
      expect(postPageReducer(errorState, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(postPageReducer(errorState, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound presents not-found', () => {
      expect(postPageReducer(errorState, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError stays error', () => {
      expect(postPageReducer(errorState, loadError)).toEqual({ status: 'error' });
    });
  });

  it('never reaches notFound without a completed response', () => {
    // The not-found view must not flash while loading: only loadNotFound produces it.
    let state = initialPostPageState;
    state = postPageReducer(state, loadStart);

    expect(state.status).toBe('loading');
    expect(state.status).not.toBe('notFound');
  });
});

describe('formatDocumentTitle', () => {
  it('appends the site name to a non-blank title', () => {
    expect(formatDocumentTitle('Funny cat')).toBe('Funny cat - online-trash');
  });

  it('falls back to the plain site name for null', () => {
    expect(formatDocumentTitle(null)).toBe('online-trash');
  });

  it('falls back to the plain site name for an empty title', () => {
    expect(formatDocumentTitle('')).toBe('online-trash');
  });

  it('falls back to the plain site name for a blank-only title', () => {
    expect(formatDocumentTitle('   ')).toBe('online-trash');
  });
});
