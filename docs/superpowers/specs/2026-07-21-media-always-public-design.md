# Media Always Public — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorming), pending implementation plan
**Touches:** features 010 (admin meme moderation) and 011 (upload / auto-activation)

## Problem

Admins open the moderation console (`/admin/trashposts`) and see every meme in
every state — the row data is already `withTrashed()` with no activation filter.
But the **images** of inactive, pending, and soft-deleted memes do not render:
`AdminTrashpostResource` builds thumbnail URLs from the `public` disk and null-checks
`exists()`, and `MediaVisibilityService` has physically moved those memes' bytes off
the `public` disk to the private `local` disk. So a moderator reviewing a pending or
taken-down meme sees a placeholder, not the picture they must judge.

We want admins to see the actual image for **inactive, pending, and soft-deleted**
memes.

## Decision

Keep every meme's media on the `public` disk at all times. Remove the
move-media-to-match-visibility mechanism entirely.

This **reverses the 2026-07-10 anti-bypass decision** that introduced
`MediaVisibilityService`. That review moved a hidden meme's bytes off the public disk
so a saved permalink could not fetch a taken-down image's bytes directly, bypassing
the API's activation/trashed filtering. We are accepting that trade-off: the raw image
bytes of a hidden meme become fetchable again by anyone who knows or guesses the URL.
The reasoning: a moderator cannot moderate what they cannot see, and admin visibility
of hidden media outweighs the direct-URL-fetch risk for this site.

What does **not** change and still protects hidden memes at the API layer:

- The public feed (`TrashpostService::feed`) and single-post endpoint
  (`findVisibleByHash`) filter with `whereNotNull('activated_at')` and SoftDeletes.
  Hidden memes' **JSON** is never served by the public API regardless of where the
  bytes live.
- **Purge** (hard delete) still deletes the bytes for good.

## Changes

### 1. Media never leaves the public disk

Remove `sync()` and its `moveAll()` / `move()` helpers from
`MediaVisibilityService`. Every caller drops the `sync()` call:

- `ModerationService::activate`, `deactivate`, `delete`, `restore` — drop the trailing
  `$this->media->sync($post)`.
- `TrashpostService::createPost` — drop the pending-upload `sync()` and remove the
  `MediaVisibilityService` constructor dependency. Pending uploads now stay on the
  public disk like everything else.

What survives is `ownedPaths()` (and its `thumbnailShared()` helper): `purge` still
needs it to know which files to delete on hard delete. The class is **renamed to
`MediaOwnershipService`** to reflect its narrowed responsibility — "which disk files
does this post own" — and its class doc is rewritten to drop all disk-matching
language. `disk()` is removed if no longer referenced.

No change to `AdminTrashpostResource`: it already reads the `public` disk and
null-checks `exists()`. Once bytes stay put, the `exists()` check passes and thumbnails
render for inactive / pending / soft-deleted memes.

### 2. One-time reconciliation: `media:republish`

The existing data already has inactive and soft-deleted memes whose bytes the **old**
code moved to the private `local` disk. They will not render until moved back. A
one-time artisan command republishes them:

- Iterate every `Trashpost::withTrashed()`.
- For each `ownedPaths()` entry that exists on the `local` disk, move it to the
  `public` disk (streamed copy, then delete the source).
- Skip entries missing from `local` (already public, or never written) — this makes
  the command **idempotent** and safe to re-run.

It touches only known post-media files (via the retained `ownedPaths()`), never the
whole disk blindly.

### 3. Purge cleanup — unchanged

`purge` / `deleteEverywhere` keeps deleting from both `public` and `local`. Media now
only ever lives on `public`, but deleting from `local` is harmless (tolerates missing)
and still sweeps any legacy `local` file the reconciliation missed. No behavior change.

### 4. Tests & docs

- `MediaVisibilityServiceTest` → `MediaOwnershipServiceTest`: drop the move/sync cases;
  keep `ownedPaths()` coverage (image variants, shared vs unshared YouTube thumbnail,
  null file).
- `ModerationServiceTest`: flip the media assertions — media stays on the `public` disk
  across activate / deactivate / delete / restore, instead of moving off and back.
- `TrashpostServiceTest`: a pending (non-trusted) upload now keeps its media on the
  `public` disk.
- New test for `media:republish`: a meme whose bytes sit on `local` gets them moved to
  `public`; re-running is a no-op.
- Update `CLAUDE.md` 010/011 descriptions to drop the media-hiding behavior and the
  pending-media-hidden claim.

## Non-goals / out of scope

- No public-API changes, no new endpoints, no frontend changes.
- No admin-only authenticated media route (the more-secure alternative was
  considered and declined in favor of the simpler always-public model).
- Video media (`ownedPaths` video coverage) remains a follow-up for when video upload
  is built — unchanged by this work.

## Constitution check

- **Minimal dependencies:** no new packages. PASS.
- **Security (Principle VI):** uploads are still validated server-side; hidden memes'
  JSON is still filtered out of the public API. The only relaxation is direct byte
  fetchability of hidden media, an accepted product trade-off documented above. PASS
  with the noted, deliberate exception.
- **Tests (≥90%):** all touched services and the new command are covered. PASS.
- **Conventions:** PSR-12 / strict types / class-of-static-methods style preserved.
  PASS.
