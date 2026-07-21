# Rating model → state-reflective (drop the ledger flags)

**Date:** 2026-07-21
**Status:** Approved (purge rule confirmed: always −1)
**Supersedes the rating mechanics of:** 011-user-rating-auto-activation

## Problem

The 011 rating model keeps a per-post ledger — two boolean columns on
`trashposts` (`rating_credited`, `rating_penalized`) — and only moves
`users.rating` when a *flag* flips. That machinery exists to make adjustments
idempotent and to make deletion a **permanent** −1 (purge keeps the penalty; a
live meme costs −2 on purge, netting −1 for life).

We are replacing that with a simpler model in which the rating purely reflects
the current state of a user's memes, driven by real state transitions.

## New model

Drop both ledger columns. `users.rating` moves on real state transitions only:

| Transition (fires **only** on a genuine state change) | Δ |
|---|---|
| activate — pending/inactive → active — manual **or** auto | **+1** |
| deactivate — active → inactive | **−1** |
| soft-delete — live → trashed | **−1** |
| restore — trashed → live | **+1** |
| **purge (hard delete)** — always, regardless of state | **−1** |

Invariant for the soft states: for a user's *existing* posts,
`rating = Σ (activated ? +1 : 0) + (soft-deleted ? −1 : 0)`.
Deletion/undeletion is now **reversible** (a departure from 011, where deletion
was a permanent penalty). Purge is the one terminal, always-costs-−1 action
(confirmed decision — not derived from the invariant).

`users.rating` stays internal (never surfaced by any API), remains out of
`$fillable`, keeps its signed-smallint saturation bounds, and is still written
**only** by `RatingService`. `TRUST_THRESHOLD = 15` auto-activation is unchanged.

## Idempotency without flags

The flags previously gave idempotency: repeated activate/delete/etc. moved the
rating at most once. That job now belongs to the **state-transition guards** in
`ModerationService`, which already exist for activate/delete/restore. To make a
guard's read-then-write atomic under concurrency (two moderators, same meme),
`ModerationService::find()` gains `lockForUpdate()` so the state check and the
adjustment happen inside one locked transaction. `deactivate` — today
unconditional — gains an `if ($activated_at !== null)` guard so it charges −1
only on a real active→inactive transition.

## Changes

1. **Migration** — new `2026_07_21_000000_drop_rating_flags_from_trashposts_table.php`:
   `up()` drops `rating_credited` + `rating_penalized`; `down()` re-adds them
   (mirrors the 011 migration) for reversibility.
2. **`Trashpost` model** — remove the two `$casts` entries.
3. **`RatingService`** — delete `settle()` and all flag handling. Keep `MIN`/
   `MAX`, `TRUST_THRESHOLD`, `shouldAutoActivate`, and the user-row-locking
   `adjust(?int $userId, int $delta)` (null owner → no-op, saturating). The
   semantic methods become bare owner adjustments (no flags, no post write):
   `credit` → +1, `releaseCredit` → −1, `penalize` → −1, `refund` → +1,
   `settlePurge` → −1 (unconditional).
4. **`ModerationService`** —
   - `find()` gains `lockForUpdate()`.
   - `activate`: unchanged guard (`activated_at === null` → set + `credit`).
   - `deactivate`: new guard `if ($post->activated_at !== null)` around
     `releaseCredit` + clearing `activated_at`.
   - `delete`: move `penalize` inside the existing `if (!trashed())` block.
   - `restore`: move `refund` inside the existing `if (trashed())` block.
   - `purge`: `settlePurge` now the unconditional −1 (call site unchanged).
5. **`TrashpostService`** auto-activate path — unchanged (a brand-new post always
   transitions into active, earning +1 via `credit`).
6. **Tests** — rewrite `RatingServiceTest` (drop flag assertions; keep saturation
   + null-owner; add the deactivate/delete/restore/purge deltas), update
   `ModerationServiceTest` (drop flag assertions; add "deactivate a
   never-activated meme moves nothing", "purge always −1"), and fix the flag
   assertions in `ModerationControllerTest`. `CreatePostTest` is unaffected.
7. **Docs** — update the 011 paragraph in both `CLAUDE.md` files' Current State.

## Out of scope

No API surface changes (rating stays internal), no frontend changes, no change
to `shouldAutoActivate` / `TRUST_THRESHOLD`, no change to media-visibility sync.
