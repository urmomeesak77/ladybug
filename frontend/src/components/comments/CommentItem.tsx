import ActionMenu from '../admin/ActionMenu';
import type { ActionMenuItem } from '../admin/ActionMenu';
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

// One comment row: author name, post time, an optional "Hidden" badge, and the body. The body
// is a plain-text React child ({comment.body}) — React escapes it, so markup shows as literal
// text and can never inject an element (never dangerouslySetInnerHTML — D10, FR-009). Admin+
// viewers get the shared kebab menu (013) with state-driven Hide/Unhide (Delete lands in US4);
// the hidden state is marked by text (the badge), not colour alone (Principle IV, FR-011).
function CommentItem({ comment, viewerRole = 'guest', onHide, onUnhide }: CommentItemProps) {
  const date = PostDate.format(comment.createdAt);
  const canModerate = Role.rank(viewerRole) >= Role.rank('admin');
  const items = buildItems(comment, onHide, onUnhide);

  return (
    <li className="comment">
      <div className="comment__header">
        <span className="comment__author">{comment.author ?? 'Anonymous'}</span>
        {date ? <span className="comment__date">{date}</span> : null}
        {comment.hidden ? <span className="comment__badge">Hidden</span> : null}
        {canModerate ? <ActionMenu items={items} label="More actions for this comment" /> : null}
      </div>
      <p className="comment__body">{comment.body}</p>
    </li>
  );
}

// The state-driven admin action set: Unhide for a hidden comment, Hide for a visible one
// (Delete is added in US4). Each closes over the row's hash so the parent hook can moderate it.
function buildItems(
  comment: Comment,
  onHide?: (hash: string) => void,
  onUnhide?: (hash: string) => void,
): ActionMenuItem[] {
  const visibility: ActionMenuItem = comment.hidden
    ? { label: 'Unhide', onChoose: () => onUnhide?.(comment.hash) }
    : { label: 'Hide', onChoose: () => onHide?.(comment.hash) };
  return [visibility];
}

export default CommentItem;
