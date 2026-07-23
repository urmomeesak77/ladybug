// The raw comment shape as the API serializes it (CommentResource). Snake_case mirrors the
// JSON; the render-ready Comment below is the camelCase shape the components read. `hidden` is
// only ever true for an admin viewer — guests/members never receive hidden rows.
export type RawComment = {
  hash: string;
  body: string;
  username: string | null;
  hidden: boolean;
  created_at: string | null;
};

// One newest-first batch plus the public count and the older-comments cursor (contracts).
export type RawCommentPage = {
  data: RawComment[];
  meta: { total: number; next_cursor: string | null; has_more: boolean };
};

export type Comment = {
  hash: string;
  body: string;
  // The author display name (account name, or the snapshot for an orphaned comment), or null.
  author: string | null;
  hidden: boolean;
  createdAt: string | null;
};

// The accumulated list state the hook holds and every reducer op returns. `total` is the
// PUBLIC (non-hidden) count regardless of viewer (D7); `cursor`/`hasMore` drive "load more".
export type CommentPage = {
  comments: Comment[];
  total: number;
  cursor: string | null;
  hasMore: boolean;
};

// Pure mapping and the list reducer for the comment section: raw→model plus prepend-new,
// append-older, replace-row, and drop-row with the public-count adjustments each story needs.
// IO lives in lib/commentApi; this class never touches the network (Principle II).
export class CommentModel {
  static mapComment(raw: RawComment): Comment {
    return {
      hash: raw.hash,
      body: raw.body,
      author: raw.username,
      hidden: raw.hidden,
      createdAt: raw.created_at,
    };
  }

  static mapPage(raw: RawCommentPage): CommentPage {
    return {
      comments: raw.data.map(CommentModel.mapComment),
      total: raw.meta.total,
      cursor: raw.meta.next_cursor,
      hasMore: raw.meta.has_more,
    };
  }

  // A freshly posted comment goes on top (newest-first) and always counts publicly (it is
  // created visible), so the public total gains one (US2, FR-006). Cursor/has-more are the
  // older-batch paging state and are untouched.
  static prependNew(list: CommentPage, comment: Comment): CommentPage {
    return { ...list, comments: [comment, ...list.comments], total: list.total + 1 };
  }

  // Append the next older batch after the current rows and take the fetched batch's cursor,
  // has-more, and (authoritative, self-healing) public total (US1, FR-019).
  static appendOlder(list: CommentPage, older: CommentPage): CommentPage {
    return {
      comments: [...list.comments, ...older.comments],
      total: older.total,
      cursor: older.cursor,
      hasMore: older.hasMore,
    };
  }

  // Swap one row in place after a hide/unhide (US3). Adjust the public count ONLY on a real
  // hidden-state transition — visible→hidden drops one, hidden→visible adds one — so an
  // idempotent/concurrent repeat that returns the same state never double-counts (FR-015,
  // edge case "Concurrent moderation"). A no-op when the row is not on the page.
  static replaceRow(list: CommentPage, updated: Comment): CommentPage {
    const prior = list.comments.find((comment) => comment.hash === updated.hash);
    if (!prior) {
      return list;
    }
    const comments = list.comments.map((comment) => (comment.hash === updated.hash ? updated : comment));
    const total = list.total + CommentModel.countDelta(prior.hidden, updated.hidden);
    return { ...list, comments, total };
  }

  // Drop a deleted row (US4). Decrement the public count only when the removed row was
  // visible — a hidden comment was never in the public count, so removing it leaves it
  // unchanged (FR-014). A no-op when the hash is not on the page.
  static dropRow(list: CommentPage, hash: string): CommentPage {
    const removed = list.comments.find((comment) => comment.hash === hash);
    if (!removed) {
      return list;
    }
    const comments = list.comments.filter((comment) => comment.hash !== hash);
    const total = removed.hidden ? list.total : list.total - 1;
    return { ...list, comments, total };
  }

  // The public-count change from a hidden-state change: +1 when a row becomes visible, -1
  // when it becomes hidden, 0 when the state is unchanged.
  private static countDelta(wasHidden: boolean, isHidden: boolean): number {
    if (wasHidden === isHidden) {
      return 0;
    }
    return wasHidden ? 1 : -1;
  }
}
