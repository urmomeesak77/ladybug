# Quickstart: Validating Video Upload

## Prerequisites

- Dev stack running (`docker compose up`), backend + frontend containers healthy.
- `ffmpeg` installed in the `ladybug-php` dev image (rebuild the image after this
  feature's Dockerfile change: `docker compose build backend`).
- A logged-in member account whose e-mail is verified (existing upload gate,
  unchanged). To exercise the auto-activation path, use/promote an account with
  `rating >= 15` or an admin+ account; otherwise the post lands pending (both are
  worth checking — see Scenario 4).
- Two small real video files under 20 MB: one `.mp4`, one `.webm` (e.g. export a
  few-second clip from any editor, or reuse `backend/tests/fixtures/sample.mp4` /
  `sample.webm` once added by this feature's tasks).
- One file over 20 MB (any format) and one file renamed to `.mp4` whose actual bytes
  are not a video (e.g. a renamed `.txt`).

## Scenario 1 — Happy path upload (US1, FR-001/002/003/005/006, SC-001)

1. Sign in, open `/upload`.
2. Select the **Video** option (third tab, alongside Image and YouTube).
3. Confirm the form now shows a video file picker and the title field — no image or
   YouTube inputs.
4. Choose the valid `.mp4`, enter a title, submit, noting roughly how long it takes
   from submit to the permalink redirect.
5. **Expect**: redirected to the new post's permalink (`/posts/{hash}`), same as an
   image/YouTube upload. The video plays back correctly (Scenario 3 covers
   feed/permalink playback specifics). Upload-to-redirect time should feel
   comparable to uploading a similarly sized image (SC-001) — poster extraction is
   one `ffmpeg` invocation, not a transcode, so there should be no perceptible extra
   wait.
6. Repeat with the `.webm` file — same expected outcome.

## Scenario 2 — Rejections (US2, FR-002/003/004/007, SC-002)

1. On `/upload`, video tab, select an unsupported file (e.g. a `.mov` or any
   non-MP4/WebM video). Submit.
   - **Expect**: rejected before submission completes; error names the accepted
     formats (MP4, WebM); no new post appears anywhere (check the feed / admin
     console).
2. Select a valid-format file over 20 MB. Submit.
   - **Expect**: rejected with a message stating the 20 MB limit; no post created.
3. Select a file named `something.mp4` whose actual content is not a valid video
   (e.g. the renamed `.txt`). Submit.
   - **Expect**: rejected the same way as an unsupported format (a corrupt/unreadable
     message distinct from the plain-format-mismatch message per the contract); no
     post created.
4. After each rejection, confirm the form still holds the title/other field so the
   member can correct and resubmit without starting over (FR-007).

## Scenario 3 — Feed and permalink playback (US3, FR-008, SC-004)

1. Open the main feed (`/`). Scroll until the newly created video post enters the
   viewport.
   - **Expect**: playback starts automatically, muted, no click required; a visible
     control lets you unmute or pause.
2. Continue scrolling so the post leaves the viewport.
   - **Expect**: playback pauses.
3. Scroll back — playback resumes automatically (still muted).
4. Open the post's own permalink directly (`/posts/{hash}`, fresh page load).
   - **Expect**: autoplay-muted starts on load, same unmute/pause control present.
5. Throttle the network (DevTools → Network → Slow 3G) and reload the permalink.
   - **Expect**: the poster (preview) image is shown while the video is still
     loading — no layout jump once playback becomes available (Edge Cases).

## Scenario 4 — Moderation parity (FR-009, SC-005)

Using an admin account and the admin console (`/admin/trashposts`):

1. Upload a video from a low-trust (non-admin, `rating < 15`) account — confirm it
   appears **pending** in the admin console with a visible thumbnail (the poster),
   not yet in the public feed.
2. Activate it — confirm it now appears in the public feed, playable.
3. Deactivate it — confirm it disappears from the public feed but remains visible
   (with poster) in the admin console.
4. Soft-delete it, then restore it — confirm the same reversible behavior already
   verified for image posts (011/010) holds for video.
5. Purge it — confirm the post, its video file, and its poster (all size variants)
   are gone from disk (verify via the backend container:
   `docker compose exec backend ls storage/app/public/video/trash storage/app/public/image/trash`
   for the post's shard/hash — nothing should remain).

## Scenario 5 — Resolution/no-upscale check (FR-006, SC-003)

1. Upload a video with a small source resolution (e.g. 320×240).
2. Inspect the post's `original`/`sizes` fields via `GET /api/posts/{hash}` (or the
   Network tab).
   - **Expect**: no returned poster variant exceeds 320px width — the same
     never-upscale rule already verified for small images (SC-003).

## Automated coverage (for reference, not manual steps)

- Backend: `backend/tests/Feature/Http/Controllers/CreatePostTest.php` (video
  branches), a new `TrashpostVideoProcessorTest.php` (or equivalent) under
  `backend/tests/Unit/Services/`, `MediaOwnershipServiceTest.php` video coverage,
  `MediaPathTest.php` video-path coverage.
- Frontend: `frontend/tests/lib/uploadApi.test.ts`, `uploadModel.test.ts`,
  `frontend/tests/components/MediaTabs.test.tsx`, `UploadMediaField.test.tsx`,
  `MemeMedia.test.tsx` (video branch + autoplay/pause behavior), and a Playwright
  `frontend/tests/e2e/upload.spec.ts` video case.
- Run via the project's existing Docker-based test commands (`php:8.3-cli` container
  for backend, `npm test` for frontend) — no new test runner introduced.
