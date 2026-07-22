import { describe, expect, it } from 'vitest';

import { PostModel } from '../../src/lib/postModel';
import type { PostPageAction, PostPageState } from '../../src/lib/postModel';
import type { FeedPost } from '../../src/lib/feedModel';

const post: FeedPost = {
  hash: 'abc1234567',
  title: 'Hi',
  permalink: '/posts/abc1234567',
  media: { kind: 'none' },
  hidden: null,
  author: 'alice',
  createdAt: '2026-07-22T12:00:00Z',
};

const otherPost: FeedPost = {
  hash: 'xyz7654321',
  title: 'Other',
  permalink: '/posts/xyz7654321',
  media: { kind: 'none' },
  hidden: null,
  author: 'bob',
  createdAt: '2026-07-21T08:30:00Z',
};

const loadStart: PostPageAction = { type: 'loadStart' };
const loadSuccess: PostPageAction = { type: 'loadSuccess', post };
const loadNotFound: PostPageAction = { type: 'loadNotFound' };
const loadError: PostPageAction = { type: 'loadError' };

describe('PostModel.initialState', () => {
  it('starts idle', () => {
    expect(PostModel.initialState).toEqual({ status: 'idle' });
  });
});

describe('postPageReducer', () => {
  describe('from idle', () => {
    const idle: PostPageState = { status: 'idle' };

    it('loadStart begins loading', () => {
      expect(PostModel.reducer(idle, loadStart)).toEqual({ status: 'loading' });
    });

    it('ignores results that arrive before any load started', () => {
      // No request is in flight while idle, so result actions are no-ops.
      expect(PostModel.reducer(idle, loadSuccess)).toEqual(idle);
      expect(PostModel.reducer(idle, loadNotFound)).toEqual(idle);
      expect(PostModel.reducer(idle, loadError)).toEqual(idle);
    });
  });

  describe('from loading', () => {
    const loading: PostPageState = { status: 'loading' };

    it('loadStart stays loading', () => {
      expect(PostModel.reducer(loading, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(PostModel.reducer(loading, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound presents not-found', () => {
      expect(PostModel.reducer(loading, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(PostModel.reducer(loading, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from loaded', () => {
    const loaded: PostPageState = { status: 'loaded', post };

    it('loadStart drops the previous post and returns to loading', () => {
      // Hash change: the old meme must never bleed into the next view.
      expect(PostModel.reducer(loaded, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess replaces the post (latest result wins)', () => {
      expect(PostModel.reducer(loaded, { type: 'loadSuccess', post: otherPost }))
        .toEqual({ status: 'loaded', post: otherPost });
    });

    it('loadNotFound presents not-found', () => {
      expect(PostModel.reducer(loaded, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(PostModel.reducer(loaded, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from notFound', () => {
    const notFound: PostPageState = { status: 'notFound' };

    it('loadStart starts a fresh load (notFound is never sticky)', () => {
      expect(PostModel.reducer(notFound, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(PostModel.reducer(notFound, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound stays notFound', () => {
      expect(PostModel.reducer(notFound, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError presents the failure', () => {
      expect(PostModel.reducer(notFound, loadError)).toEqual({ status: 'error' });
    });
  });

  describe('from error', () => {
    const errorState: PostPageState = { status: 'error' };

    it('loadStart (retry) clears the stale error before the new result lands', () => {
      expect(PostModel.reducer(errorState, loadStart)).toEqual({ status: 'loading' });
    });

    it('loadSuccess lands the post', () => {
      expect(PostModel.reducer(errorState, loadSuccess)).toEqual({ status: 'loaded', post });
    });

    it('loadNotFound presents not-found', () => {
      expect(PostModel.reducer(errorState, loadNotFound)).toEqual({ status: 'notFound' });
    });

    it('loadError stays error', () => {
      expect(PostModel.reducer(errorState, loadError)).toEqual({ status: 'error' });
    });
  });

  it('never reaches notFound without a completed response', () => {
    // The not-found view must not flash while loading: only loadNotFound produces it.
    let state = PostModel.initialState;
    state = PostModel.reducer(state, loadStart);

    expect(state.status).toBe('loading');
    expect(state.status).not.toBe('notFound');
  });
});

describe('formatDocumentTitle', () => {
  it('appends the site name to a non-blank title', () => {
    expect(PostModel.formatDocumentTitle('Funny cat')).toBe('Funny cat - online-trash');
  });

  it('falls back to the plain site name for null', () => {
    expect(PostModel.formatDocumentTitle(null)).toBe('online-trash');
  });

  it('falls back to the plain site name for an empty title', () => {
    expect(PostModel.formatDocumentTitle('')).toBe('online-trash');
  });

  it('falls back to the plain site name for a blank-only title', () => {
    expect(PostModel.formatDocumentTitle('   ')).toBe('online-trash');
  });
});
