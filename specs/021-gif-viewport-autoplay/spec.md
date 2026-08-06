# Feature Specification: Animated Image Viewport Autoplay

**Feature Branch**: `021-gif-viewport-autoplay`

**Created**: 2026-08-06

**Status**: Draft

**Input**: User description: "gifs should have similar logic to autoplay when they come to viewport and stop when leave like videos have"

## Clarifications

### Session 2026-08-06

- Q: Should this behavior cover animated WebP as well as GIF, given the upload form has accepted animated WebP since feature 014? → A: All animated images. GIF and animated WebP both start/stop on scroll under one rule; two animated formats behaving differently in the same feed would be an unexplainable inconsistency.
- Q: When an animated image leaves the viewport and later comes back, what should a visitor see? → A: It freezes on the frame it was showing when it left, and resumes from that exact frame when it comes back — the closest match to how video autoplay already behaves.
- Q: If frame-accurate freeze/resume is only possible in browsers with a built-in frame-by-frame image decoding capability, is it acceptable for browsers lacking it to keep animating continuously? → A: Yes — those browsers fall back to exactly today's always-animating experience, consistent with the existing degradation rule (FR-012), and the feature ships without any new third-party dependency.
- Q: Should the "media taller than the screen can never be half-visible" fix apply to both animated images and videos, or only to animated images? → A: Only to animated images. Video keeps its current half-visible rule untouched, so this feature changes nothing about existing video posts; the two media types therefore diverge only for media taller than the viewport.
- Q: How should the site know a meme is animated rather than a still picture — should the browser work it out, or should the server tell it? → A: The browser determines it from the image file it is already loading. No API field, no stored flag, no backfill over the existing library; a single-frame GIF/WebP is a natural no-op.
- Q: On a long feed, should playback data be kept for every animated meme scrolled past, or released? → A: Keep it for a fixed maximum number of most-recently-seen animated posts and drop the least-recently-seen beyond that cap. The remembered frame position is always retained, even for a dropped post, so resume stays exact.
- Q: For a meme too tall to ever have half of itself on screen at once, what counts as "on screen enough to animate"? → A: Either test qualifies — half the image is on screen, OR the visible part of it covers at least half the screen's height. The existing half-the-image rule is unchanged for normally sized memes; the second test is an addition only a tall meme can satisfy.
- Q: How many animated memes should keep their playback resources at once before the least-recently-seen ones are released? → A: 12 — roughly a screenful plus margin above and below, so ordinary scrolling (including backing up a few posts) never releases a meme the visitor is about to look at, while memory stays bounded far below the 200-entry page break.
- Q: Should the site honor a file's "play N times then stop" setting once it is driving the frames itself? → A: Yes. A play-once meme plays once and rests on its final frame, exactly as today; a meme that has finished stays finished across scroll-aways rather than replaying; and off-screen time never consumes a play-through, since a frozen meme's playback does not advance.

**Throughout this spec, "animated image" means an animated GIF or an animated WebP meme.** Single-frame GIF/WebP files count as static images and are explicitly out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Only the animated images I'm actually looking at are moving (Priority: P1)

A visitor scrolls the endless feed on a page that happens to contain several animated memes. Today every one of them animates continuously from the moment it loads, whether it is on screen or far above/below the fold — a wall of motion competing for attention and burning battery. After this change, an animated image starts animating as it scrolls into view and stops as it scrolls out, exactly the way video posts already behave.

**Why this priority**: This is the entire feature and the behavior the request describes. Everything else is a consequence or a refinement of it.

**Independent Test**: Load a feed containing at least three animated posts spread far enough apart that only one is on screen at a time. Scroll slowly and confirm that at any moment only the animated image(s) currently on screen are in motion, and that each one visibly resumes as it enters and freezes as it leaves.

**Acceptance Scenarios**:

1. **Given** a feed with an animated image post below the fold, **When** the visitor scrolls until that post is substantially on screen, **Then** it begins animating without any click or other action from the visitor.
2. **Given** an animated image post currently animating on screen, **When** the visitor scrolls until it is substantially off screen, **Then** it stops animating and holds the frame it was showing at that moment.
3. **Given** an animated image post the visitor has already scrolled past, **When** they scroll back to it, **Then** it resumes animating from the frame it was frozen on — not from the beginning.
4. **Given** a feed containing an animated image post and a video post, both fitting on the visitor's screen, **When** the visitor scrolls each of them into view, **Then** both *begin* playing at the same point in the scroll (they use the same "enough of it is visible" rule), so the feed behaves consistently regardless of media type. On the way *out* the two part company by design: the animated image freezes as soon as less than that much of it is left on screen, while a video keeps playing until it has left the viewport entirely — today's video behavior, deliberately untouched (FR-004/FR-004a).
5. **Given** a feed containing both an animated GIF post and an animated WebP post, **When** the visitor scrolls each into and out of view, **Then** the two behave identically — the visitor cannot tell which underlying format they are looking at from its start/stop behavior.

---

### User Story 2 - An animated image on its own page behaves the same (Priority: P2)

A visitor opens an animated meme's permalink page directly. It animates while on screen and stops if the visitor scrolls down far enough (for example into a long comment thread) that the image leaves the viewport.

**Why this priority**: The single-post view is the second place these memes are shown, and one still spinning away above a long comment thread is the same waste the feed change is meant to fix. Secondary only because the feed is where most memes are seen and where the problem multiplies.

**Independent Test**: Open an animated meme's own page, confirm it animates on arrival, scroll down past it into the comments, confirm it has stopped, then scroll back up and confirm it resumes from where it froze.

**Acceptance Scenarios**:

1. **Given** an animated meme's permalink page, **When** the page finishes loading with the image on screen, **Then** it animates.
2. **Given** that page scrolled down so the image is off screen, **When** the visitor scrolls back up to it, **Then** it resumes animating from the frame it froze on.

---

### User Story 3 - Nothing else about the post changes (Priority: P3)

A visitor interacts with an animated post the way they always have: its frozen frame looks like the meme (not a blank or broken box), clicking it in the feed still opens its permalink, its description is still available to screen readers, and ordinary non-animated images are completely unaffected.

**Why this priority**: Guards against the change introducing regressions in the surrounding post experience. Lower priority than the behavior itself, but a broken permalink click or a blank placeholder would be worse than the original problem.

**Independent Test**: With a stopped animated post, confirm the visible frame is recognisably the meme; click it in the feed and confirm it navigates to the post's permalink; confirm a static JPEG/PNG post in the same feed renders and behaves exactly as before.

**Acceptance Scenarios**:

1. **Given** an animated post that is currently stopped, **When** the visitor looks at it, **Then** a frame of the meme is shown — never a blank space, a broken-image marker, or a differently sized box than when it is animating.
2. **Given** an animated post in the feed, **When** the visitor clicks it, **Then** it opens that post's permalink, exactly as clicking any image post does today.
3. **Given** a feed containing static images (JPEG, PNG, single-frame GIF/WebP), **When** the visitor scrolls past them, **Then** their appearance and behavior are entirely unchanged by this feature.

---

### Edge Cases

- **Single-frame ("static") GIF or WebP**: has nothing to animate. It renders as an ordinary image and the start/stop behavior is a no-op — no flicker, no placeholder swap, no visible difference from today.
- **An animated image taller than the viewport**: on a narrow/short screen a very tall meme may never have "half of it" on screen at once. It MUST still animate once its on-screen part covers at least half the screen's height (FR-011 test (b)), rather than being permanently frozen because it can never satisfy the half-the-image rule. A *video* taller than the viewport keeps today's behavior — deliberately unchanged by this feature (FR-004a) — so the two types diverge here and at the stop point (FR-004), and nowhere else.
- **Two or more animated images on screen at once**: all of them meeting the visibility rule animate simultaneously; the feature does not pick a single "active" one.
- **Fast scrolling / flick-scrolling past a post**: rapidly crossing in and out MUST NOT produce visible flicker, a size change, or repeated placeholder swaps.
- **A deep feed with more animated posts than the cap allows** (up to 200 entries before the page break): once more than 12 animated posts have been seen, the least-recently-seen ones give up their playback resources but keep their remembered frame. Scrolling far back to one of them MUST look no different from scrolling back to a recent one — it re-readies itself and resumes on the frame it froze on, with no visible blank, flicker, or restart.
- **A meme whose file says "play once" (or any finite number of times)**: it plays exactly that many times and then rests on its final frame — the same thing a visitor sees today. Scrolling away and back does not restart it or grant it extra plays, and the plays it has left are not consumed while it sits off screen (FR-003a).
- **An animated image that leaves and re-enters view many times**: the resume point must stay coherent across an unlimited number of cycles — it must not drift back to the first frame, jump forward, or accumulate error.
- **An animated image scrolled out of view before it has finished loading**: it must not be left in a broken or permanently frozen state; once loaded it follows the normal rule for wherever it then is.
- **Browser or environment without viewport detection, or without frame-level control of animated images**: the image falls back to plain, always-animating behavior — i.e. exactly today's experience — rather than being stuck frozen or half-working. The same visitor's static images, video posts, and permalink clicks are unaffected by being on such a browser.
- **Media that fails to load**: behaves as a broken image post does today (the post degrades to title-only); this feature adds no new failure mode.
- **Already-published memes**: those uploaded before this feature shipped MUST behave identically to newly uploaded ones — the behavior cannot depend on being re-uploaded.
- **Tab backgrounded or the browser minimised**: nothing needs to be animating. Because this feature drives the frames itself rather than leaving them to the platform, it MUST stop while the page is hidden and pick up where it left off on return (FR-002a) — a hidden tab must never quietly advance frames or burn a play-through.
- **An animated image at the very bottom of the feed as more entries load in**: the arrival of newly loaded entries MUST NOT stop one that is still on screen, nor start ones that are not.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically start an animated image post's animation when enough of that post's media is scrolled into the viewport, without any visitor action.
- **FR-002**: The system MUST stop an animated image post's animation when its media leaves the viewport, holding the frame it was showing at that moment as a still image.
- **FR-002a**: The system MUST also stop playback while the page itself is hidden (tab backgrounded, browser minimised) and resume it when the page becomes visible again with the post still in view, holding the frame exactly as FR-002 requires. Hidden time MUST NOT advance a meme's frames, drift its resume point, or consume a play-through (FR-003a).
- **FR-003**: The system MUST resume animation from the frozen frame — not from the first frame — each time a stopped animated image re-enters the viewport, and MUST stay coherent over an unlimited number of enter/leave cycles, in every visitor environment that offers frame-level control over animated image playback.
- **FR-003a**: The system MUST honor an animated image file's own repeat setting: a file that declares a finite number of play-throughs MUST play that many times and then rest on its final frame, and MUST stay finished across subsequent scroll-aways rather than replaying. Because a stopped image's playback does not advance (FR-002), time spent off screen MUST NOT consume a play-through. A file that declares endless repetition MUST keep looping for as long as it is on screen.
- **FR-004**: The system MUST **start** an animated image post's animation at the same point in the scroll as a video post starts — the same "enough of it is visible" threshold video already uses — so for media that fits on the visitor's screen the two begin playing together. The **stop** point deliberately differs: an animated image freezes as soon as it falls below that threshold (FR-002), whereas video's existing rule keeps playing until the video has left the viewport entirely. That asymmetry is a property of the existing video implementation, which this feature does not touch (FR-004a); copying it onto animated images would leave a meme that is 90% off screen still animating, which is precisely what this feature exists to stop. The second deliberate divergence is FR-011 (media taller than the viewport), which applies to animated images only.
- **FR-004a**: The system MUST NOT change the start/stop behavior of existing video posts. Video's visibility rule stays exactly as it is today — including its "pause only once fully out of view" stop point (FR-004) and its handling of video taller than the viewport, both of which remain separate known limitations outside this feature's scope.
- **FR-005**: The system MUST apply this behavior wherever these memes are shown to visitors — the feed and a post's own permalink page.
- **FR-006**: The system MUST apply this behavior to both animated GIF and animated WebP memes, indistinguishably: a visitor MUST NOT be able to tell the two formats apart from their start/stop behavior.
- **FR-007**: The system MUST apply this behavior to memes that were already published before this feature shipped, with no re-upload, re-processing, or migration required of the uploader.
- **FR-008**: The system MUST leave non-animated images (JPEG, PNG, single-frame GIF/WebP) visually and behaviorally unchanged.
- **FR-009**: The system MUST keep the stopped state visually indistinguishable in size and position from the animating state — starting or stopping MUST NOT shift the page layout or change the post's dimensions.
- **FR-010**: The system MUST preserve everything else about the post: its permalink click target in the feed, its text alternative for assistive technology, and its place in the feed's ordering and paging.
- **FR-011**: The system MUST animate an **animated image** when **either** of two tests passes: (a) at least half of the image is on screen — the same rule video uses (FR-004) — **or** (b) the on-screen part of the image covers at least half of the screen's height. Test (b) is an addition that only a meme taller than the screen can satisfy, so no normally sized meme's behavior changes; it guarantees a meme too tall to ever satisfy (a) still animates once it dominates the view, rather than staying permanently frozen. Both tests are scoped to animated images; video is explicitly excluded (FR-004a).
- **FR-012**: The system MUST degrade to today's always-animating behavior — never to a permanently frozen image — in any environment where it cannot detect what is on screen **or cannot control an animated image frame by frame**. Start/stop is an enhancement for environments that support it; every other visitor MUST see exactly the current experience, and no visitor MUST see a broken, blank, or stuck post.
- **FR-013**: The system MUST NOT introduce a manual play/pause control, an overlay, or any new visible chrome on these posts; the only change a visitor perceives is when the animation runs. [Assumption — see Assumptions]
- **FR-014**: The system MUST NOT change how these memes are uploaded, validated, stored, or moderated, and MUST NOT change any existing public URL.
- **FR-015**: The system MUST NOT require a new third-party dependency to satisfy FR-003; where frame-level control is unavailable, FR-012's fallback applies instead.
- **FR-016**: The system MUST determine whether a post's media is animated from the image file the visitor's browser already loads, and MUST NOT add a field to any API response, a column to stored post data, or a backfill pass over already-published memes to do so. A single-frame GIF/WebP MUST therefore be handled as a no-op discovered at render time, not as a separately flagged case.
- **FR-017**: The system MUST hold the resources that make frame-level playback possible for at most **12** most-recently-seen animated posts, releasing them for the least-recently-seen posts beyond that cap, so that memory use on a feed does not grow with how far the visitor has scrolled. Twelve is about a screenful plus margin either side, so ordinary scrolling — including backing up a few posts — does not reach the release path.
- **FR-018**: The system MUST retain each animated post's remembered frame position for as long as that post is on the page — including posts whose playback resources have been released under FR-017 — so a released post still resumes from the frame it froze on (FR-003) rather than restarting.
- **FR-019**: The system MUST make a post whose playback resources were released under FR-017 ready again on its own when it is scrolled back to, within the same start-up budget as any other post (SC-002), and MUST NOT show a blank, broken, or restarted-from-the-beginning image while doing so.

### Key Entities

- **Post (existing)**: unchanged in shape, and unchanged in what it reports. Whether a post's media is animated is determined by the visitor's browser from the image file it already downloads — not from a stored field and not from anything the server reports. No new uploader input, no new moderation state, no new API field, and no backfill over already-published memes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a feed page containing 10 animated posts, at any given moment only the ones currently on screen are animating — 0 off-screen posts are in motion.
- **SC-002**: An animated image begins (or resumes) animating within 0.5 seconds of scrolling into view, so the visitor never perceives a "dead" image they have to wait on.
- **SC-003**: Starting or stopping an animated image causes 0 pixels of layout shift and 0 change in the post's rendered size.
- **SC-004**: On a browser offering frame-level control, after 10 consecutive scroll-away/scroll-back cycles the animation resumes from where it froze every time — 0 unintended restarts from the first frame.
- **SC-005**: 100% of animated posts published before this feature shipped exhibit the new behavior without any re-upload.
- **SC-006**: Animated GIF and animated WebP posts produce identical observable start/stop/resume behavior in 100% of the acceptance scenarios above.
- **SC-007**: 100% of non-animated image posts are unaffected — no change in appearance, click behavior, or text alternative.
- **SC-008**: Scrolling rapidly through an animation-heavy feed produces no visible flicker or placeholder swap on any post.
- **SC-009**: On a browser without frame-level control, 100% of animated posts render and animate exactly as they do today — 0 frozen, blank, or broken posts — and 0 new third-party dependencies were added to ship the feature.
- **SC-010**: 100% of existing video posts show unchanged start/stop behavior after this feature ships — 0 observable differences in when a video begins or pauses.
- **SC-012**: A visitor who returns to a backgrounded tab finds every animated post on the frame it held when the tab was hidden — 0 frames advanced and 0 play-throughs consumed while hidden (FR-002a).
- **SC-011**: Scrolling a feed to its full 200-entry page break holds playback resources for no more than **12** animated posts at any moment, so memory does not grow with scroll depth; posts beyond the cap still resume from their frozen frame in 100% of scroll-backs (SC-004 holds regardless of how many animated posts have been seen).

## Assumptions

- **No new controls.** The request is specifically about the *autoplay/stop-on-scroll* behavior videos already have, not about videos' play/pause/mute/scrub overlay. Animated images therefore get the automatic behavior only and stay chrome-free, keeping the feed's image posts clickable as permalinks (which the video overlay deliberately is not).
- **Visibility rule is inherited, not redefined.** "Enough of it is visible" means the same threshold video autoplay already uses, so for media that fits on screen the two types *start* together at the same scroll position. They do not *stop* together: the existing video hook pauses only once a video has fully left the viewport, while an animated image freezes the moment it drops below the shared threshold (FR-004). Matching video's late stop would defeat the feature, and changing video's stop to match the image would be a change to the video slice this feature deliberately keeps its hands off (FR-004a) — so the asymmetry is accepted and documented rather than resolved here. This feature does not re-tune the threshold itself and does not touch video at all — the other extension is FR-011's second test (visible part covers ≥ half the screen's height) for an animated image taller than the screen, added on the image side only and unreachable by a normally sized meme. Whether video should get the same allowance is a separate change, deliberately not bundled here to keep this feature's blast radius off the existing video slice.
- **Frame-accurate resume (FR-003) is the demanding requirement here.** Freezing on the current frame and picking that frame back up is straightforward for video but is *not* something the platform offers for animated image formats out of the box. Planning must therefore choose a mechanism that gives per-frame control; this spec deliberately does not prescribe which, but it does assume the cost lands in the plan rather than being absorbed by weakening FR-003 to "restart from the beginning". Where such a mechanism is simply not available to a visitor, the resolution is FR-012's fallback (keep animating as today) — **not** a weaker resume and **not** a new dependency (FR-015).
- **Sound is not involved.** These formats are silent, so none of the muting concerns that surround video autoplay apply.
- **Reduced-motion preferences are out of scope for this feature.** Animated-image autoplay deliberately matches the existing video autoplay policy rather than diverging from it; whether *all* auto-playing media should be gated on a reduced-motion preference is a separate, site-wide accessibility decision affecting videos equally.
- **Detection of "is this media animated" happens in the browser** from the file it already downloads (FR-016) — the feature adds no new uploader input, no new moderation state, no API field, no stored column, and no change to the public post identifier or URLs. Consequence: this is a **frontend-only** feature; the backend is not touched at all, which is also what makes it work unchanged for every meme published before it shipped (FR-007).
- **No new third-party dependency** (Constitution Principle I) — now a decided constraint, FR-015, not merely an assumption. Frame-accurate resume is delivered only where the visitor's environment already provides frame-level control; a browser that lacks it gets FR-012's always-animating fallback rather than the feature pulling in a decoder package. This deliberately makes the improvement progressive: the set of visitors who see freeze/resume grows on its own as browsers gain the capability.
