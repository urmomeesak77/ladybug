# Soft/Hard Delete Options in the Moderation Delete Confirm — Design

**Date:** 2026-07-10
**Feature branch:** `010-admin-meme-moderation`
**Status:** Approved

## Problem

The moderation table's delete confirmation modal offers only one destructive
outcome: soft delete (`DELETE /api/admin/posts/{hash}` → `SoftDeletes`). An
admin has no way to remove a meme permanently — its DB row and its image files
stay on disk forever. The confirm popup should offer three choices: **soft
delete**, **hard delete** (remove the DB row and its media files), and
**cancel**. A soft-deleted row (currently Restore-only) must also be purgeable
without restoring it first.

## Decision

- **Dedicated purge route** — `DELETE /api/admin/posts/{hash}/purge` alongside
  the unchanged soft-delete `DELETE /{hash}`, matching the existing
  one-route-per-action style (activate/deactivate/restore). Rejected: a
  `?mode=hard` flag on the existing route — mixes two severities behind one
  endpoint, and a client bug could escalate a soft delete into a purge.
- **Generalize `Confirm` to an action list** — the dialog needs a variable
  number of destructive buttons (two on a live row, one on a soft-deleted
  row). Rejected: a second optional caption/callback pair — two parallel
  optionals are clumsier than one list, and `ask()` has exactly one caller.
- **Hard delete is single-click inside the popup** with a visually stronger
  danger style and an explicit "permanently" caption. Rejected: a second
  nested confirm — two modals in a row for trusted admins is clunky.
- **YouTube thumbnail: delete only when unreferenced** — thumbnails are stored
  once per video id and shared between posts embedding the same video.

## Design

### 1. Backend route + controller

`routes/api.php`, inside the existing `auth:sanctum` + `role:admin` group:

```php
Route::delete('/posts/{hash}/purge', [ModerationController::class, 'purge'])
    ->name('api.admin.posts.purge');
```

`ModerationController::purge(string $hash): Response` calls
`ModerationService::purge($hash)` and returns **204 No Content** — there is no
updated row to hand back. Unknown hash → 404 (same lookup semantics as the
other actions); guest → 401, member → 403 via the group middleware.

### 2. Backend service — `ModerationService::purge()`

`purge(string $hash): void`:

1. Resolve the post `withTrashed()` by hash (`firstOrFail` → 404).
2. Compute the deletable file list **before** touching the row:
   - When `file` is set: `MediaPath::imageRelativePath($size, $code, $ext)`
     for every `MediaPath::imageSizes()` (original/800/500/300/100), where
     `$code`/`$ext` split from `file` exactly as `TrashpostImageService` does.
   - When `youtube_thumbnail` is set: include it **only if no other post
     (including soft-deleted) references the same path** —
     `Trashpost::withTrashed()->where('youtube_thumbnail', $path)
     ->whereKeyNot($post->id)->exists()` guards the shared file.
3. `forceDelete()` the row **first**, then `Storage::disk('public')
   ->delete($paths)` (best-effort). Order rationale: a failed file cleanup
   leaves invisible, harmless orphan files; the reverse order could leave a
   live row pointing at deleted media. `Filesystem::delete()` does not throw
   on missing files, so purging a post whose media is already gone succeeds.

Video files are out of scope: no current code path stores them
(`MediaPath::videoRelativePath` is unused by uploads).

### 3. Frontend dialog — multi-action `Confirm`

`frontend/src/hooks/useNotice.ts`:

```ts
export type ConfirmAction = {
  caption: string;
  onChoose: () => void;
  strong?: boolean;   // heavier danger styling for irreversible actions
};

export type Confirm = {
  message: string;
  title?: string;
  actions: ConfirmAction[];
};
```

`ConfirmDialog` renders **Cancel** (always present; Esc keeps reporting
through `onCancel`) followed by one danger button per action, in array order.
`strong` actions get a heavier style (filled danger background vs. the
current look) via a `notice-dialog__danger--strong` modifier in `theme.css`,
themed for light and dark. Color is never the only signal — the caption
itself says "permanently" (Principle IV). `NoticeProvider` wraps each
`onChoose` the same way it wraps `onConfirm` today: `clear()` then the
callback, exactly once. The old `confirmCaption`/`onConfirm` fields are
removed — `ModerationActions` is the only caller and migrates in the same
change.

### 4. Frontend moderation flow

- `ModerationApi.purge(hash)` — `DELETE /api/admin/posts/{hash}/purge` with
  the usual CSRF header; expects 204, so it returns a plain
  `{ ok: boolean }` (no row parse) rather than `ModerationActionResult`.
- `useModeration` gains `removeRow(hash: string): void` — filters the purged
  row out of the loaded page in place. The admin stays on the current page
  (FR-017's spirit); the pagination meta stays as fetched until the next page
  load (acceptable staleness).
- `ModerationActions.DeletionControl`:
  - **Live row** — trash button asks with actions
    `[Soft delete → ModerationApi.remove]`,
    `[Delete permanently (strong) → ModerationApi.purge]`.
  - **Soft-deleted row** — now renders Restore **and** a trash button whose
    popup offers only `[Delete permanently (strong)]`.
  - Soft delete still routes through `RowAction.apply` (row updates in
    place); purge routes through a sibling that calls `removeRow(hash)` on
    success, threaded down from `useModeration` next to `onApply`.
- Copy in `ModerationModel` (user-facing vocabulary is "post"):
  - Live row: explains both outcomes — soft delete hides the post and is
    restorable; permanent delete removes the post and its files forever.
  - Soft-deleted row: the post is already hidden; permanent delete removes it
    and its files forever.

### 5. Tests (mirror source; ≥90% coverage gate)

Backend (`Storage::fake('public')` throughout):

- Feature `ModerationControllerTest`: purge → 204, row gone (`forceDeleted`),
  all five size variants gone; works on both live and soft-deleted rows;
  unknown hash → 404; guest → 401; member → 403.
- Unit `ModerationServiceTest`: shared YouTube thumbnail survives a purge of
  one referencing post; last-reference thumbnail file is deleted; image-less
  post (YouTube-only) purges without touching image paths; missing files on
  disk don't fail the purge.

Frontend:

- `moderationApi.test.ts` — purge sends DELETE to the purge URL with CSRF,
  maps 204 → ok, non-2xx/network → not ok.
- `moderationModel.test.ts` — both new copy variants, with and without title.
- `useModeration.test.ts` (or hook test file as mirrored) — `removeRow` drops
  exactly the named row, no-op for an absent hash.
- `ConfirmDialog.test.tsx` / `NoticeProvider.test.tsx` — renders one button
  per action plus Cancel, `strong` class applied, each action fires exactly
  once then clears, cancel/Esc fire nothing.
- `ModerationActions.test.tsx` — live row's dialog offers both deletes;
  soft-deleted row offers Restore + permanent-only dialog; purge success
  removes the row via the threaded callback.
- Update the moderation Playwright e2e delete flow for the renamed/added
  modal buttons.

### 6. Spec artifact touch-up

Amend `specs/010-admin-meme-moderation/spec.md` (FR-016: the confirm now
offers soft delete, permanent delete, and cancel; soft-deleted rows expose
permanent delete) and the API contract
`specs/010-admin-meme-moderation/contracts/admin-moderation-api.md` (new
purge endpoint) so the artifacts stay truthful.

## Out of scope (YAGNI)

Bulk purge, purge of video files, undo for hard delete, retention/audit
logging, a second nested confirmation.
