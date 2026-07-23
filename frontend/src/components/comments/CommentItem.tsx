import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
import { useNotice } from '../../hooks/useNotice';
import { PostDate } from '../../lib/postDate';
import type { Comment } from '../../lib/commentModel';
import { Role } from '../../lib/role';
import type { RoleName } from '../../lib/role';

export type CommentItemProps = {
  comment: Comment;
  // The viewer's role decides whether the admin action menu shows; the server still gates the
  // actions. Defaults to guest so the read-only US1 usage needs no extra prop.
  viewerRole?: RoleName;
  onHide?: (hash: string) => void;
  onUnhide?: (hash: string) => void;
  onDelete?: (hash: string) => void;
};

type CommentActionProps = {
  comment: Comment;
  onHide?: (hash: string) => void;
  onUnhide?: (hash: string) => void;
  onDelete?: (hash: string) => void;
};

// One comment row: author name, post time, an optional "Hidden" badge, and the body. The body
// is a plain-text React child ({comment.body}) — React escapes it, so markup shows as literal
// text and can never inject an element (never dangerouslySetInnerHTML — D10, FR-009). The hidden
// state is marked by text (the badge), not colour alone (Principle IV, FR-011). Admin+ viewers
// additionally get the moderation menu (rendered by CommentActions, which owns the confirm).
function CommentItem({ comment, viewerRole = 'guest', onHide, onUnhide, onDelete }: CommentItemProps) {
  const date = PostDate.format(comment.createdAt);
  const canModerate = Role.rank(viewerRole) >= Role.rank('admin');

  return (
    <li className="comment">
      <div className="comment__header">
        <span className="comment__author">{comment.author ?? 'Anonymous'}</span>
        {date ? <span className="comment__date">{date}</span> : null}
        {comment.hidden ? <span className="comment__badge">Hidden</span> : null}
        {canModerate ? (
          <CommentActions comment={comment} onHide={onHide} onUnhide={onUnhide} onDelete={onDelete} />
        ) : null}
      </div>
      <p className="comment__body">{comment.body}</p>
    </li>
  );
}

// The admin-only per-row moderation menu (shared ActionMenu kebab, 013). Rendered only for
// admin+ viewers, so useNotice is required only in that subtree. Hide/Unhide act immediately;
// Delete is destructive and irreversible, so it opens a confirm first (FR-013, D9).
function CommentActions({ comment, onHide, onUnhide, onDelete }: CommentActionProps) {
  const { ask } = useNotice();

  function askDelete(): void {
    ask({
      title: 'Delete comment?',
      message: 'This permanently deletes the comment. This cannot be undone.',
      actions: [{ caption: 'Delete permanently', onChoose: () => onDelete?.(comment.hash), strong: true }],
    });
  }

  return <ActionMenu items={buildItems(comment, onHide, onUnhide, askDelete)} label="More actions for this comment" />;
}

// The state-driven admin action set: Unhide for a hidden comment or Hide for a visible one,
// then the destructive Delete. Each closes over the row's hash so the parent hook can act on it.
function buildItems(
  comment: Comment,
  onHide: ((hash: string) => void) | undefined,
  onUnhide: ((hash: string) => void) | undefined,
  askDelete: () => void,
): ActionMenuItem[] {
  const visibility: ActionMenuItem = comment.hidden
    ? { label: 'Unhide', onChoose: () => onUnhide?.(comment.hash) }
    : { label: 'Hide', onChoose: () => onHide?.(comment.hash) };
  return [visibility, { label: 'Delete', danger: true, onChoose: askDelete }];
}

export default CommentItem;
