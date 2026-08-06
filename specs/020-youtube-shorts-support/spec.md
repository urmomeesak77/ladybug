# Feature Specification: YouTube Shorts Support

**Feature Branch**: `020-youtube-shorts-support`

**Created**: 2026-08-06

**Status**: Draft

**Input**: User description: "lets add youtube shorts support. use same upload field and detect it automatically"

## Clarifications

### Session 2026-08-06

- Q: Should a Shorts post's vertical player keep the same overall card width as a regular YouTube post (with empty space beside a narrower centered video), or should the whole feed card narrow to hug the vertical video? → A: Keep the same card width as regular posts; the vertical player is centered within that width, with empty space on either side.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paste a Shorts link and have it just work (Priority: P1)

A member uploading a meme pastes a `youtube.com/shorts/...` link into the same YouTube field they'd use for a regular video. They don't pick a "Shorts" mode or flip any switch — the site recognizes it's a Shorts link and posts it like any other YouTube meme.

**Why this priority**: This is the entire feature. Without automatic detection, Shorts links either get rejected or get embedded incorrectly, and that's the whole gap being closed.

**Independent Test**: Paste a `youtube.com/shorts/{id}` URL into the upload field, submit with a title, and confirm the post is created and viewable — no separate UI path required.

**Acceptance Scenarios**:

1. **Given** the upload form's YouTube field, **When** a member pastes `https://www.youtube.com/shorts/dQw4w9WgXcQ`, **Then** the field accepts it the same way it accepts a `watch?v=`, `youtu.be/`, or `/embed/` link, with no separate "Shorts" toggle or mode.
2. **Given** a valid Shorts link, **When** the member submits the upload, **Then** the post is created successfully and stores the video the same way any other YouTube-sourced post does.
3. **Given** a submitted Shorts meme, **When** any visitor opens the feed or the post's own page, **Then** the video plays inline as an embedded player, oriented correctly for Shorts' tall (vertical) video instead of being letterboxed inside a wide player built for regular video.

---

### User Story 2 - Existing Shorts-link rejections start working (Priority: P2)

A member who previously pasted a Shorts link and got "Enter a valid YouTube link" tries again after this change ships and it succeeds.

**Why this priority**: Confirms the fix actually resolves the bug from the member's point of view, not just internally.

**Independent Test**: Attempt the same Shorts URL that was previously rejected by the upload form; verify it's now accepted.

**Acceptance Scenarios**:

1. **Given** a Shorts URL that today produces "Enter a valid YouTube link", **When** the member submits it after this feature ships, **Then** no validation error is shown and the upload proceeds.

---

### User Story 3 - Shorts thumbnails and previews look right elsewhere (Priority: P3)

Anywhere the site already generates a preview or thumbnail from a YouTube post (feed cards, link-sharing previews), a Shorts-sourced post produces a correct, non-distorted thumbnail just like a regular YouTube post does.

**Why this priority**: Secondary polish — the core viewing experience (P1) matters more than preview surfaces, but a broken or stretched thumbnail would be a visible regression once Shorts posts start appearing.

**Independent Test**: Publish a Shorts post and inspect its feed thumbnail and any social/link preview image; confirm it renders without distortion or errors.

**Acceptance Scenarios**:

1. **Given** a published Shorts post, **When** it appears in the feed, **Then** its preview renders without errors or visible stretching.

---

### Edge Cases

- A pasted link that merely contains the word "shorts" elsewhere but isn't a real `/shorts/{id}` path is treated as an ordinary invalid link, same as any other unrecognized YouTube URL today.
- A Shorts link whose video has since been deleted or made private behaves the same way an already-unavailable regular YouTube link behaves today (no new failure mode introduced).
- A Shorts video that happens to be wide/landscape (rare but possible) still displays correctly — detection is based on the URL path, not on the video's actual dimensions.
- Existing, already-published posts that reference regular (non-Shorts) links are unaffected; this feature only widens what the upload field accepts and how playback is oriented.
- A Shorts post's card is taller than a regular post's card (due to the vertical player) but stays the same width, so it does not disrupt the feed grid's column alignment with neighboring cards.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept YouTube Shorts links (`youtube.com/shorts/{id}` form) through the exact same upload field already used for other YouTube links — no new field, mode, or toggle.
- **FR-002**: The system MUST automatically recognize a Shorts link is a Shorts link from its URL shape alone, without the uploader stating it explicitly.
- **FR-003**: The system MUST extract the same kind of video identifier from a Shorts link as it does from watch/short-share/embed links today, so a Shorts-sourced post is stored and served through the existing YouTube post pathway.
- **FR-004**: The system MUST reject a YouTube field value that is neither a recognized regular link nor a recognized Shorts link, with the same validation feedback already shown for invalid links today.
- **FR-005**: The system MUST play back a Shorts-sourced post as an embedded, inline player wherever YouTube posts are already played back (feed and single-post view).
- **FR-006**: The system MUST present a Shorts-sourced post's player in a vertical (tall) orientation rather than the wide orientation used for regular YouTube posts, so the video isn't letterboxed. The surrounding feed card MUST keep the same overall width as a regular post's card — the vertical player is centered within that width, not the card itself narrowed to hug the video.
- **FR-007**: The system MUST produce a working thumbnail/preview image for Shorts-sourced posts anywhere thumbnails are already generated for YouTube posts.

### Key Entities

- **Post (existing)**: unchanged in shape — a Shorts-sourced post is stored exactly like any other YouTube-sourced post; only the accepted link format and the playback orientation change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can go from pasting a YouTube Shorts link to a published, playable post in the same number of steps as with a regular YouTube link (no extra steps).
- **SC-002**: 100% of valid `youtube.com/shorts/{id}` links submitted through the upload field are accepted; 100% of links that are not real Shorts or regular YouTube links are still rejected.
- **SC-003**: Shorts-sourced posts display with no visible letterboxing or distortion in the feed or on their own page, compared to their source video's actual orientation.

## Assumptions

- Shorts links follow YouTube's current public URL shape, `youtube.com/shorts/{11-character-id}` (optionally with `www.` or a mobile/`m.` host), mirroring how `youtu.be/{id}` and `/embed/{id}` are already recognized.
- "Automatic detection" means URL-shape recognition only — the system does not call out to YouTube to confirm a video is actually a Short; a `/shorts/{id}` link is trusted to be a Shorts link.
- Playback continues to use the same privacy-friendly embed host and sandboxed iframe approach already used for regular YouTube posts (Principle VI) — only the container's aspect ratio changes for Shorts.
- No visual "Shorts" badge or label is required on the post; the only user-visible difference is the vertical player shape.
- This feature does not change how uploads choose between image/YouTube/video modes in the upload form (014's tablist) — Shorts links go through the existing YouTube tab.
