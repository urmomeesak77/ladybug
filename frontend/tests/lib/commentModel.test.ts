import { describe, expect, it } from 'vitest';

import { CommentModel } from '../../src/lib/commentModel';
import type { CommentPage, RawComment, RawCommentPage } from '../../src/lib/commentModel';

const rawComment: RawComment = {
  hash: 'Ab3-xY9_q2',
  body: 'first line\nsecond line',
  username: 'alice',
  hidden: false,
  created_at: '2026-07-23T10:15:00.000000Z',
};

const rawPage: RawCommentPage = {
  data: [rawComment],
  meta: { total: 42, next_cursor: 'Y3Vyc29y', has_more: true },
};

describe('CommentModel.mapComment', () => {
  it('maps a raw API comment into a render-ready comment, camelCasing the keys', () => {
    expect(CommentModel.mapComment(rawComment)).toEqual({
      hash: 'Ab3-xY9_q2',
      body: 'first line\nsecond line',
      author: 'alice',
      hidden: false,
      createdAt: '2026-07-23T10:15:00.000000Z',
    });
  });

  it('passes a null author through (an orphaned comment with no snapshot)', () => {
    expect(CommentModel.mapComment({ ...rawComment, username: null }).author).toBeNull();
  });

  it('carries the hidden flag through for an admin-visible hidden row', () => {
    expect(CommentModel.mapComment({ ...rawComment, hidden: true }).hidden).toBe(true);
  });
});

describe('CommentModel.mapPage', () => {
  it('maps the batch rows and the meta into a render-ready page', () => {
    expect(CommentModel.mapPage(rawPage)).toEqual({
      comments: [CommentModel.mapComment(rawComment)],
      total: 42,
      cursor: 'Y3Vyc29y',
      hasMore: true,
    });
  });

  it('maps an empty batch to an empty page with no cursor', () => {
    const empty: RawCommentPage = { data: [], meta: { total: 0, next_cursor: null, has_more: false } };

    expect(CommentModel.mapPage(empty)).toEqual({ comments: [], total: 0, cursor: null, hasMore: false });
  });
});

describe('CommentModel.prependNew', () => {
  const list: CommentPage = CommentModel.mapPage(rawPage);

  it('places the new comment at the top and increments the public count', () => {
    const fresh = CommentModel.mapComment({ ...rawComment, hash: 'New0000000', body: 'nice' });
    const next = CommentModel.prependNew(list, fresh);

    expect(next.comments[0]).toEqual(fresh);
    expect(next.comments).toHaveLength(list.comments.length + 1);
    expect(next.total).toBe(list.total + 1);
  });

  it('leaves the cursor and has-more untouched', () => {
    const fresh = CommentModel.mapComment({ ...rawComment, hash: 'New0000000' });
    const next = CommentModel.prependNew(list, fresh);

    expect(next.cursor).toBe(list.cursor);
    expect(next.hasMore).toBe(list.hasMore);
  });
});

describe('CommentModel.appendOlder', () => {
  const list: CommentPage = CommentModel.mapPage(rawPage);

  it('appends the older batch after the current rows and advances the cursor/has-more', () => {
    const older: CommentPage = CommentModel.mapPage({
      data: [{ ...rawComment, hash: 'Older00000' }],
      meta: { total: 42, next_cursor: null, has_more: false },
    });
    const next = CommentModel.appendOlder(list, older);

    expect(next.comments).toEqual([...list.comments, ...older.comments]);
    expect(next.cursor).toBeNull();
    expect(next.hasMore).toBe(false);
    expect(next.total).toBe(42);
  });
});

describe('CommentModel.replaceRow', () => {
  const visible = CommentModel.mapComment(rawComment);
  const other = CommentModel.mapComment({ ...rawComment, hash: 'Other00000' });
  const list: CommentPage = { comments: [visible, other], total: 2, cursor: null, hasMore: false };

  it('swaps the row with the matching hash and leaves the rest identical', () => {
    const updated = { ...visible, body: 'edited' };
    const next = CommentModel.replaceRow(list, updated);

    expect(next.comments).toEqual([updated, other]);
  });

  it('decrements the public count on a visible → hidden transition', () => {
    const hidden = { ...visible, hidden: true };

    expect(CommentModel.replaceRow(list, hidden).total).toBe(1);
  });

  it('increments the public count on a hidden → visible transition', () => {
    const hiddenList: CommentPage = { ...list, comments: [{ ...visible, hidden: true }, other], total: 1 };
    const revealed = { ...visible, hidden: false };

    expect(CommentModel.replaceRow(hiddenList, revealed).total).toBe(2);
  });

  it('leaves the count unchanged for an idempotent repeat (same hidden state)', () => {
    const sameState = { ...visible, body: 'text unchanged in state' };

    expect(CommentModel.replaceRow(list, sameState).total).toBe(2);
  });

  it('is a no-op when the row is not on the page', () => {
    const stray = CommentModel.mapComment({ ...rawComment, hash: 'Missing000' });

    expect(CommentModel.replaceRow(list, stray)).toEqual(list);
  });
});

describe('CommentModel.dropRow', () => {
  const visible = CommentModel.mapComment(rawComment);
  const hidden = CommentModel.mapComment({ ...rawComment, hash: 'Hidden0000', hidden: true });
  const list: CommentPage = { comments: [visible, hidden], total: 1, cursor: null, hasMore: false };

  it('removes the row with the matching hash', () => {
    expect(CommentModel.dropRow(list, visible.hash).comments).toEqual([hidden]);
  });

  it('decrements the public count when the dropped row was visible', () => {
    expect(CommentModel.dropRow(list, visible.hash).total).toBe(0);
  });

  it('leaves the public count unchanged when the dropped row was hidden', () => {
    expect(CommentModel.dropRow(list, hidden.hash).total).toBe(1);
  });

  it('is a no-op when the hash is not on the page', () => {
    expect(CommentModel.dropRow(list, 'Missing000')).toEqual(list);
  });
});
