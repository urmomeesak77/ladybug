# Feature Specification: Upload Page Polish

**Feature Branch**: `014-upload-page-polish`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Upload page. 1. change title to just Upload. 2. form is visually bad. make it more like register and login forms are. 3. Image/Youtube should be 'Tabs' instead of checkboxes. 4. Title should be required. 5. allow webp image format."

## Clarifications

### Session 2026-07-22

- Q: WebP images can be animated (like GIFs), but the default image decoder only reads the first frame — how should an animated WebP upload be handled? → A: Preserve animation — an animated WebP stays animated (its size variants keep all frames), matching how animated GIFs are already handled; this requires a resize tool the default decoder cannot provide, so a new dependency must be approved during planning.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A polished upload form with a required title (Priority: P1)

A verified member on the upload page wants the form to look and feel like the
rest of the site's forms — the same clean, single-column layout they already
know from signing up and logging in — headed by a simple "Upload" heading rather
than the current "Upload a meme" wording. When they post, the site asks them for
a title every time, so no meme is posted untitled.

**Why this priority**: This is the headline of the request — the form today looks
out of place, and titles are currently skippable. Fixing the visual consistency
and making the title mandatory is the core value; it is usable and demonstrable on
its own even before the tab and WebP changes land.

**Independent Test**: Sign in as a verified member, open the upload page, and
confirm the heading reads "Upload", the form is laid out in the same style as the
login and registration forms, and attempting to post with an empty title is
refused with a clear, field-level message.

**Acceptance Scenarios**:

1. **Given** a verified member on the upload page, **When** the page renders, **Then** the page heading reads exactly "Upload" and the form uses the same visual layout, spacing, field styling, and button treatment as the login and registration forms.
2. **Given** the upload form, **When** the member leaves the title empty and submits, **Then** the submission is rejected before any meme is created and a clear field-level message tells them the title is required.
3. **Given** the upload form with a title filled in and a valid media input, **When** the member submits, **Then** the meme is created exactly as before this feature (same success outcome and destination).
4. **Given** the upload form on a narrow (mobile) and a wide (desktop) viewport, and in both light and dark colour schemes, **When** it renders, **Then** it stays readable and correctly laid out, matching how the auth forms already respond.

---

### User Story 2 - Choosing Image vs YouTube with tabs (Priority: P2)

A member deciding whether to post an image or a YouTube link wants to pick the
kind of meme by switching between two clearly labelled tabs — "Image" and
"YouTube" — instead of the current checkbox/radio control. The selected tab shows
only the input relevant to that choice, so it is obvious which one is active.

**Why this priority**: This refines how the media type is chosen. It improves
clarity and matches the requested design, but the form is already usable after
Story 1, so it ranks below the core redesign. It is independently testable.

**Independent Test**: Open the upload page, confirm two tabs ("Image" and
"YouTube") are shown with exactly one active at a time, switch between them, and
confirm the active tab reveals only its own input (image picker or YouTube link)
and that only that input's value is submitted.

**Acceptance Scenarios**:

1. **Given** the upload form, **When** it renders, **Then** the media type is presented as two tabs, "Image" and "YouTube", with exactly one selected at a time and the image tab selected by default.
2. **Given** the Image tab is selected, **When** the member looks at the form, **Then** only the image file input is shown; **When** they switch to the YouTube tab, **Then** only the YouTube link input is shown, and vice-versa.
3. **Given** the member has entered a value in one tab and then switches tabs, **When** they submit, **Then** only the currently selected tab's input is used, so the "an entry is either an image or a YouTube link, never both" rule cannot be violated from the UI.
4. **Given** a keyboard or assistive-technology user, **When** they reach the tabs, **Then** the tabs are operable without a mouse and expose which tab is selected and which panel it controls; the selected state is never conveyed by colour alone.

---

### User Story 3 - Posting a WebP image (Priority: P3)

A member with a meme saved in the WebP image format wants to upload it directly,
just like a JPEG, PNG, or GIF, without having to convert it first.

**Why this priority**: This widens the set of accepted formats. It is a real
capability gain but affects only members whose source file is WebP, so it ranks
last. It is independently shippable and testable.

**Independent Test**: On the upload page's Image tab, choose a valid WebP file,
give it a title, and post; confirm the meme is accepted, processed, and appears in
the feed and on its permalink like any other image meme.

**Acceptance Scenarios**:

1. **Given** the Image tab, **When** the member picks a file, **Then** the file picker offers/accepts WebP alongside the previously accepted image formats.
2. **Given** a valid WebP image with a title, **When** the member submits, **Then** the meme is created, its size variants are generated, and it renders in the feed and on its permalink like any other image meme.
3. **Given** a valid *animated* WebP with a title, **When** the member submits, **Then** the meme is created with its animation preserved (every size variant keeps all frames and still animates), exactly as an animated GIF does.
4. **Given** a file that is not a supported image type, **When** the member submits, **Then** it is rejected with a clear message, exactly as before this feature (WebP is added to the allowed set, nothing previously rejected becomes allowed beyond WebP).

---

### Edge Cases

- **Title whitespace-only**: A title consisting solely of spaces is treated as empty and rejected as missing, not accepted as a title.
- **Switching tabs after an error**: When the member switches media tabs, any validation error shown for the tab they left does not linger against the now-hidden input.
- **Both inputs somehow populated**: Because only the selected tab's input is submitted, the server's existing "exactly one of image or YouTube" rule is never tripped from normal UI use; if it is tripped anyway, the existing server rejection still applies.
- **WebP that is malformed or oversized**: A file claiming to be WebP but not a well-formed image, or one exceeding the existing size limit, is rejected by the same server-side validation that guards the other image formats.
- **Animated WebP**: An animated WebP is accepted and keeps its animation in every size variant (like an animated GIF), rather than being flattened to its first frame.
- **Unverified or unauthenticated visitor**: The upload page's existing access gate (verified members and above only) is unchanged; this feature does not alter who may reach or use the form.

## Requirements *(mandatory)*

### Functional Requirements

#### Form presentation & title (US1)

- **FR-001**: The upload page heading MUST read exactly "Upload" (replacing the current "Upload a meme").
- **FR-002**: The upload form MUST adopt the same visual presentation as the login and registration forms — the same overall layout, field styling, spacing, error presentation, and primary-button treatment — so the three forms read as one family.
- **FR-003**: The upload form MUST remain responsive and theme-aware to the same standard as the auth forms: it MUST follow the visitor's light/dark colour scheme and remain usable on narrow and wide viewports.
- **FR-004**: A title MUST be required to post a meme. Submitting with a missing or whitespace-only title MUST be rejected before any meme is created, with a clear, field-level message identifying the title as required.
- **FR-005**: The title's required rule MUST be enforced on the server, not only in the browser, so a request that omits the title is refused authoritatively.
- **FR-006**: Aside from the title now being mandatory, a successful post MUST produce the same outcome as before this feature (same created meme and same post-submit destination).

#### Media type tabs (US2)

- **FR-007**: The choice between an image upload and a YouTube link MUST be presented as two labelled tabs, "Image" and "YouTube", replacing the current checkbox/radio control, with the Image tab selected by default.
- **FR-008**: Exactly one tab MUST be selected at any time, and the form MUST show only the input belonging to the selected tab (the image file picker for Image, the link field for YouTube).
- **FR-009**: Only the currently selected tab's input MUST be submitted, preserving the existing "an entry is either an image or a YouTube link, never both" rule from the UI side.
- **FR-010**: The tabs MUST be operable by keyboard and MUST expose to assistive technology which tab is selected and which input panel it controls; the selected state MUST NOT be signalled by colour alone.

#### WebP support (US3)

- **FR-011**: The upload MUST accept the WebP image format in addition to the currently supported image formats, both in what the file picker offers and in what the server admits.
- **FR-012**: A validly uploaded WebP image MUST be processed into the same size variants as other image formats and MUST render identically in the feed and on its permalink.
- **FR-012a**: An animated WebP MUST retain its animation through processing — every generated size variant MUST keep all frames and still animate — mirroring the existing animated-GIF handling; an animated WebP MUST NOT be silently flattened to a single frame.
- **FR-013**: Server-side upload validation MUST continue to reject non-image and malformed files and MUST continue to enforce the existing size limit; adding WebP MUST NOT relax any other validation.

#### Cross-cutting

- **FR-014**: No meme, in any list or response, MUST be identified to the client by an internal database identifier; the existing public handle continues to be the only public identifier.
- **FR-015**: This feature MUST NOT change who may reach or use the upload form (the existing verified-member-and-above access gate is unchanged).

### Key Entities *(include if feature involves data)*

- **Meme upload**: The in-progress upload the member is composing — a required title plus exactly one media source (an image file or a YouTube link, chosen by tab). On success it becomes a meme entry identified by its existing public handle. This feature changes how the upload is composed and validated (required title, tabbed media choice, WebP accepted), not what a meme is.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The upload page shows the heading "Upload" and a form whose layout and styling are visually consistent with the login and registration forms.
- **SC-002**: 100% of attempts to post with a missing or whitespace-only title are refused with a field-level "required" message, and no such meme is ever created.
- **SC-003**: The media type is chosen via two tabs, with exactly one input visible at a time; 100% of submissions carry only the selected tab's input.
- **SC-004**: A valid WebP image can be uploaded end-to-end and appears in the feed and on its permalink like any other image meme; an animated WebP still animates in every size variant after processing (no frames lost).
- **SC-005**: The tabs and form are fully operable using only the keyboard, and the media-type selection is conveyed without relying on colour alone.
- **SC-006**: Every upload outcome that worked before this feature (JPEG/PNG/GIF image and YouTube link posts) still works unchanged, aside from the new required-title rule.

## Assumptions

- The "make it like register and login" instruction means reusing the existing auth-form visual treatment (the same layout and field/button styling the login and registration pages already use), not designing a new look.
- The required-title rule applies to both media types (image and YouTube); there is no exception where a title may be omitted.
- A whitespace-only title counts as missing (trimmed before the required check), consistent with treating a blank title as no title.
- Switching media tabs keeps the single-source rule by submitting only the active tab's input; the inactive input's value and any stale error for it are not submitted.
- "Checkboxes" in the request refers to the current radio-style media-type toggle; replacing it with tabs is a presentation change to the same either/or choice, not a change to what may be posted.
- WebP is added to the existing server-side image validation and image-processing path the same way the current formats are handled. Static WebP reuses the existing in-house image processing; **animated** WebP (per the 2026-07-22 clarification) must retain its animation, which the current image processor cannot do — so, like animated GIFs rely on `gifsicle`, animated-WebP resizing requires a resize tool the default decoder lacks. That tool is a **new dependency requiring explicit approval during planning** (Minimal Dependencies principle); the specific tool is a plan-phase decision.
- The upload page's existing access gate (verified members and above) and the single-media-source server rule are reused unchanged; this feature does not alter authorization or the either/or backend rule.
