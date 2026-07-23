import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../hooks/useAuth';
import type { CommentCreateResult } from '../../lib/commentApi';

const MAX_LENGTH = 1000;

// Maps a failed create to a human message. Validation prefers the server's field message;
// the rest cover the states the composer can hit if session/verify/rate changed after render.
function messageFor(result: Exclude<CommentCreateResult, { ok: true }>): string {
  switch (result.kind) {
    case 'validation':
      return result.errors.body?.[0] ?? 'Your comment could not be posted.';
    case 'rateLimited':
      return 'You are commenting too quickly. Please wait a minute and try again.';
    case 'auth':
      return 'Please sign in again to comment.';
    case 'unverified':
      return 'Please verify your e-mail address to comment.';
    case 'notFound':
      return 'This post is no longer available.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// The comment composer, gated by the viewer's auth/verify state (FR-005): a guest sees a
// sign-in prompt, a signed-in unverified user a verify-e-mail prompt, and a verified user the
// labelled textarea + submit with inline empty/length validation and server-error surfacing
// (FR-007, FR-008). Posting is delegated to `onSubmit` (the useComments submit), which prepends
// the created row in place — this component owns only the field and its messages.
function CommentForm({ onSubmit }: { onSubmit: (body: string) => Promise<CommentCreateResult> }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return (
      <p className="comment-form__prompt">
        <Link to="/login">Sign in</Link> to add a comment.
      </p>
    );
  }
  if (user.emailVerifiedAt === null) {
    return (
      <p className="comment-form__prompt">
        <Link to="/verify-email">Verify your e-mail</Link> to add a comment.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed === '') {
      setError('Comment cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setError(`Comment must be ${MAX_LENGTH} characters or fewer.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(trimmed);
    setSubmitting(false);
    if (result.ok) {
      setBody('');
      return;
    }
    setError(messageFor(result));
  }

  return (
    <form className="comment-form" onSubmit={handleSubmit} noValidate>
      <label className="comment-form__label" htmlFor="comment-body">Add a comment</label>
      <textarea
        id="comment-body"
        className="comment-form__field"
        value={body}
        maxLength={MAX_LENGTH}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? 'comment-error' : undefined}
      />
      {error !== null ? <p id="comment-error" className="comment-form__error" role="alert">{error}</p> : null}
      <button type="submit" className="comment-form__submit" disabled={submitting}>
        {submitting ? 'Posting…' : 'Post comment'}
      </button>
    </form>
  );
}

export default CommentForm;
