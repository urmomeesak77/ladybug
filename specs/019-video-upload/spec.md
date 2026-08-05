# Feature Specification: Video Upload

**Feature Branch**: `019-video-upload`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "add option to upload videos. standard common formats. max 20mb each"

## Clarifications

### Session 2026-08-05

- Q: Which video formats should the upload accept, given "MOV" has inconsistent native browser playback outside Safari while MP4/WebM are natively web-playable everywhere? → A: MP4 + WebM only — both are natively web-playable everywhere, no transcoding needed.
- Q: Should video posts follow the exact same trust-threshold auto-activation/moderation model as image posts, or does video's higher moderation risk warrant stricter handling (e.g., always pending)? → A: Same as images — video posts use the identical TRUST_THRESHOLD auto-activation rule already applied to image/YouTube posts; no separate moderation policy for video.
- Q: How should video posts start playback in the feed and on the permalink page? → A: Autoplay muted on scroll — video starts playing automatically (no sound) once scrolled into view, and pauses when scrolled out of view; a visible control lets the visitor unmute or pause.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload a video as a new post (Priority: P1)

A member who can already upload an image or a YouTube link wants to share a
short video clip they have on their device instead. On the upload page they
choose a "video" option alongside the existing image and YouTube choices,
pick a video file from their device, give the post a title, and submit it.
The video becomes a new post that others can watch, exactly like an
image or YouTube post today.

**Why this priority**: This is the entire feature — without the ability to
submit a video file as a post, nothing else in this spec has anything to act
on.

**Independent Test**: As a verified member, open the upload page, choose the
video option, select a valid video file under the size limit, provide a
title, and submit. Confirm a new post is created that plays the uploaded
video back correctly.

**Acceptance Scenarios**:

1. **Given** a verified member on the upload page, **When** they select the
   video option, **Then** the form shows a file picker for video files
   (in place of the image or YouTube-link inputs) plus the existing required
   title field.
2. **Given** a verified member has chosen a valid video file (a supported
   format, 20 MB or smaller) and entered a title, **When** they submit the
   form, **Then** the video is uploaded, a new post is created, and they are
   taken to that post the same way an image or YouTube upload behaves today.
3. **Given** a newly created video post, **When** any visitor opens it from
   the feed or its own permalink, **Then** the video plays back correctly.

---

### User Story 2 - Be stopped from uploading an unsupported or oversized video (Priority: P2)

A member tries to upload a video that is either in a format the site
doesn't support or larger than the 20 MB per-file limit. The site tells
them clearly why the file was rejected before anything is stored, so they
can fix it (re-encode, trim, or compress) and try again.

**Why this priority**: Without enforced limits, the upload feature accepts
unpredictable content, which risks excessive storage use and playback
failures for viewers. This depends on Story 1's upload path existing.

**Independent Test**: Attempt to upload a file outside the supported formats
and, separately, a supported-format file larger than 20 MB. Confirm both are
rejected with a clear, specific message and no post is created.

**Acceptance Scenarios**:

1. **Given** a member has selected a video file that is not one of the
   supported formats, **When** they attempt to submit, **Then** the upload
   is rejected with a message naming the accepted formats, and no post is
   created.
2. **Given** a member has selected a supported-format video file larger than
   20 MB, **When** they attempt to submit, **Then** the upload is rejected
   with a message stating the size limit, and no post is created.
3. **Given** a file whose name or extension claims a supported format but
   whose actual content is not a valid video, **When** the member attempts to
   submit, **Then** the upload is rejected before any post is created — the
   same outcome as an unsupported format — but with its own distinct message
   identifying the file as unreadable/corrupt, per FR-007.

---

### User Story 3 - Watch video posts in the feed and on their own page (Priority: P3)

A visitor scrolling the main feed, or viewing a single post's permalink,
encounters a video post. It's presented with a preview image (poster) drawn
from the video itself until it comes into view, at which point it starts
playing automatically with the sound muted, inline, without the visitor
having to click anything.

**Why this priority**: Uploading is only half the feature — video posts also
need to be watchable everywhere other posts already appear. This depends on
Story 1 having created a video post to display.

**Independent Test**: Open the main feed and scroll a video post into view;
confirm it automatically begins muted playback and pauses when scrolled back
out of view. Open that same post's permalink directly and confirm it also
autoplays muted on load.

**Acceptance Scenarios**:

1. **Given** a video post scrolls into view in the main feed, **When** it
   becomes visible, **Then** it automatically begins playing muted (no
   sound), showing a control the visitor can use to unmute or pause.
2. **Given** a playing video post scrolls out of view in the feed, **When**
   it is no longer visible, **Then** it pauses.
3. **Given** a video post's own permalink page, **When** a visitor opens it,
   **Then** the video automatically begins playing muted the same way it
   does in the feed, with the same unmute/pause control.
4. **Given** a visitor on a slow connection, **When** a video post is still
   loading, **Then** the preview image is shown in place of the video so the
   layout doesn't jump once playback becomes available.

---

### Edge Cases

- What happens when a selected file is technically a valid supported format
  but is corrupted or has no playable video stream? → Rejected before any
  post is created, with its own distinct "unreadable/corrupt" message — not
  the same message as an unsupported format (FR-007).
- What happens when a video's source resolution is very small (e.g., a
  low-resolution clip)? → The generated preview image must never be
  upscaled past the source video's own resolution.
- What happens when a file is exactly at the 20 MB boundary? → Files at or
  under 20 MB are accepted; files over 20 MB are rejected.
- How does the system handle a video with an unusually long duration but a
  small file size? → Out of scope for this feature; only file size and
  format are enforced (see Assumptions).
- What happens if an upload is interrupted partway (e.g., connection drop)?
  → No post is created; the member sees an error and can retry, consistent
  with existing image-upload failure handling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The upload page MUST offer a "video" option alongside the
  existing image and YouTube-link options, so a member picks exactly one
  media source per post.
- **FR-002**: The system MUST accept video files in standard, natively
  web-playable formats (MP4 and WebM) and MUST reject any other file type,
  including MOV.
- **FR-003**: The system MUST reject any video file larger than 20 MB and
  MUST NOT store it.
- **FR-004**: The system MUST verify a submitted file's actual content
  matches a supported video format, not just its filename or extension.
- **FR-005**: The system MUST require a title for a video post, identical to
  the existing requirement for image and YouTube posts.
- **FR-006**: The system MUST generate a static preview image for each
  uploaded video and MUST NOT upscale that preview beyond the video's own
  source resolution.
- **FR-007**: The system MUST let a rejected upload be corrected and
  resubmitted, showing a specific reason (unsupported format vs. size limit
  vs. unreadable/corrupt file).
- **FR-008**: Video posts MUST appear in the main feed and on their own
  permalink page and MUST automatically begin muted playback inline, in both
  places, once visible to the visitor; a feed video MUST pause when it
  scrolls out of view; a visible control MUST let the visitor unmute or
  pause at any time.
- **FR-009**: Video posts MUST go through the identical moderation,
  visibility, and trust-based auto-activation rules that already apply to
  image and YouTube posts (e.g., pending/hidden/active states, admin
  moderation actions, the same trust-score threshold) — video is not held to
  a stricter or separate moderation policy.
- **FR-010**: Uploading a video MUST require the same account state already
  required for image and YouTube uploads (signed in with a verified e-mail
  address).

### Key Entities

- **Post (existing "Trashpost")**: Gains video as a third possible media
  type alongside image and YouTube link; a video post stores the uploaded
  video file and its generated preview image instead of an image file or a
  YouTube reference.
- **Video preview image**: A single still image representing a video post,
  shown before playback in the feed and on the permalink page; derived from
  the video's own content and never upscaled past its source resolution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can go from selecting a valid video file to seeing it
  published as a post in the same amount of time it takes to publish a
  comparably sized image today.
- **SC-002**: 100% of video uploads that are the wrong format or over 20 MB
  are rejected before a post is created, with a message that identifies
  which limit was violated.
- **SC-003**: 0% of generated video preview images exceed their source
  video's own resolution.
- **SC-004**: Video posts begin muted playback automatically once visible,
  in both the feed and the permalink page, with no click or tap required
  from the visitor to start watching.
- **SC-005**: Video posts are subject to the same moderation and visibility
  outcomes as image posts in 100% of tested moderation scenarios (activate,
  deactivate, soft-delete, restore, purge).

## Assumptions

- "Standard common formats" is interpreted as MP4 and WebM — resolved via
  clarification to the two formats natively playable in every major browser
  without transcoding (MOV is explicitly excluded).
- The 20 MB limit applies per uploaded file, matching how the feature
  description frames it ("max 20mb each"); there is no separate limit on
  video duration in this feature.
- Video posts reuse the existing upload gate (signed-in, verified e-mail),
  the existing required-title rule, and the existing trust-based
  auto-activation / pending-moderation model already applied to image and
  YouTube posts — no new account requirements are introduced.
- Beyond the required autoplay-muted/scroll-pause behavior and the
  unmute/pause control, playback controls (seek, volume level) follow
  ordinary browser video player conventions; no further custom player
  behavior is specified here.
- When multiple video posts are visible in the feed at once, each plays
  muted independently; this feature does not restrict playback to a single
  concurrent video.
- Captioning/subtitles for uploaded videos are out of scope for this
  feature.
