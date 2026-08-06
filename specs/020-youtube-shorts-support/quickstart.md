# Quickstart: Validating YouTube Shorts Support

## Prerequisites

- Dev stack running (`docker compose up`), backend + frontend containers healthy.
- A logged-in member account whose e-mail is verified (existing upload gate,
  unchanged). To see the vertical player without waiting on moderation, use/promote
  an account with `rating >= 15` or an admin+ account so the post auto-activates;
  otherwise it lands pending and is only visible to you and admins (both worth
  checking — see Scenario 3).
- A real, currently-public `youtube.com/shorts/{id}` URL (any short clip works — the
  video's actual content doesn't matter, only that the id resolves).
- For comparison, a regular `watch?v=` or `youtu.be/` URL you already know works.

## Scenario 1 — Paste a Shorts link, it just works (US1, FR-001–003/005/006, SC-001)

1. Sign in, open `/upload`, select the **YouTube** tab (same field as always — no new
   tab or toggle should appear).
2. Paste the Shorts URL, enter a title, submit.
   - **Expect**: no validation error; same number of steps as pasting a regular
     YouTube link (SC-001) — nothing extra to fill in or pick.
3. **Expect**: redirected to the new post's permalink (`/posts/{hash}`).
4. On the permalink page, confirm the video plays inline as an embedded player, and
   the player is **tall/vertical**, not letterboxed inside a wide box.
5. Open the main feed (`/`) and scroll to the post.
   - **Expect**: same vertical player rendering in the feed as on the permalink.
   - **Expect**: the post's card is the same **width** as a neighboring regular-video
     card (no column-alignment shift); the vertical player sits centered inside that
     width with empty space on either side (resolved clarification).

## Scenario 2 — Regression check on the original bug (US2, SC-002)

1. Submit the same Shorts URL a second time (or any other real `/shorts/{id}` link)
   through `/upload`.
   - **Expect**: accepted — this is the exact link shape that previously produced
     "Enter a valid YouTube link."
2. Submit an invalid value that merely contains the word "shorts" without a real path
   (e.g. `https://example.com/i-love-shorts`, or `not a url with shorts in it`).
   - **Expect**: still rejected with the existing "Enter a valid YouTube link."
     message — no new failure mode, no new success case (edge case in spec.md).
3. Submit the known-good regular `watch?v=`/`youtu.be/` URL from Prerequisites.
   - **Expect**: unaffected — still accepted, still renders in the wide 16:9 player
     (regression check that the added Shorts pattern didn't change existing
     behavior).

## Scenario 3 — Moderation parity (pending/admin visibility)

Using the same low-trust account path as other upload features:

1. Upload a Shorts link from a low-trust (non-admin, `rating < 15`) account.
   - **Expect**: post lands **pending** — visible to the uploader and admin+ (via
     `/admin/trashposts`) but not in the public feed, same as a pending image/video/
     regular-YouTube post.
2. As an admin, activate it.
   - **Expect**: now appears in the public feed with the vertical player.

## Scenario 4 — Thumbnail/preview correctness (US3, FR-007, SC-003)

1. Open the admin console (`/admin/trashposts`) and locate the Shorts post from
   Scenario 1 or 3.
   - **Expect**: a real thumbnail image renders (not a broken-image placeholder),
     same as any other YouTube post row.
2. Back on the public feed/permalink, confirm no console errors and no visibly
   stretched/distorted preview image.

## Scenario 5 — Responsive/theme check (Constitution Principles IV, VIII)

1. With the Shorts post visible in the feed, resize the browser (or use DevTools
   device toolbar) across mobile (~360px), tablet, and desktop widths.
   - **Expect**: the vertical player scales down on narrow viewports (fills the full
     card width there) without ever causing horizontal scroll or clipped content.
2. Toggle OS/browser light/dark mode.
   - **Expect**: no regression to the existing YouTube embed's surrounding chrome.

## Automated coverage (for reference, not manual steps)

- Backend: `backend/tests/Unit/Utils/YoutubeTest.php` (new `/shorts/` extraction +
  `isShort()` cases), `backend/tests/Feature/Http/Controllers/CreatePostTest.php`
  (Shorts URL accepted; word-only "shorts" string still rejected),
  `backend/tests/Unit/Services/TrashpostServiceTest.php` (`youtube_is_short`
  persisted correctly).
- Frontend: `frontend/tests/lib/youtube.test.ts` (Shorts pattern),
  `frontend/tests/lib/feedModel.test.ts` (`isShort` mapping),
  `frontend/tests/components/MemeMedia.test.tsx` (vertical modifier class applied
  only when `isShort`).
- Run via the project's existing Docker-based test commands (`php:8.3-cli` container
  for backend, `npm test` for frontend) — no new test runner introduced.
