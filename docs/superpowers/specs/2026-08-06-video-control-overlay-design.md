# Video control overlay: icon buttons + scrub bar

**Date:** 2026-08-06
**Status:** Approved

## Problem

The video post overlay (`VideoMedia` in `frontend/src/components/MemeMedia.tsx`,
introduced by 019-video-upload phase 5) currently shows two text buttons —
"Unmute"/"Mute" and "Play"/"Pause" — pinned to the bottom-right of the video, always
visible. There is no way to seek within a video; playback controls beyond
mute/pause were explicitly deferred ("follow ordinary browser video player
conventions; no further custom player behavior is specified" — `specs/019-video-upload/spec.md`
assumptions).

This changes the overlay to icon buttons at the bottom-left, replaces the
always-visible chip with a hover/tap-revealed overlay that fades out, and adds a
scrub/progress bar so viewers can see and change playback position.

## Component structure

Everything stays inside `VideoMedia` (`frontend/src/components/MemeMedia.tsx`) — no
new component files, aside from a small icon glyph addition. No new dependency.

**Icons:** `moderation/ActionGlyph.tsx` already defines flat 24×24 `currentColor`
SVG path glyphs in a `Record<name, path>`, including a play triangle
(`activate`) and pause bars (`deactivate`) drawn in that style. This design adds
matching `mute`/`unmute` speaker glyphs in the same spirit (either by extending
that glyph map or a sibling one scoped to video controls — implementation's
call), rather than introducing a new icon convention.

**Overlay layout**, inside the existing `.meme-media__video-controls` wrapper:
- Mute/unmute icon button (was text "Unmute"/"Mute")
- Play/pause icon button (was text "Play"/"Pause")
- A native `<input type="range">` scrub bar spanning the full video width along
  the very bottom edge; the two icon buttons overlay its left end

```
┌───────────────────────────────┐
│                                 │
│             VIDEO               │
│                                 │
│ [🔇][▶]                        │
│▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░│  ← scrub bar (full width)
└───────────────────────────────┘
```

## Scrub bar: native `<input type="range">`

Chosen over a hand-rolled div-based progress bar. A native range input gives
keyboard operability (arrow keys seek), native slider ARIA semantics for screen
readers, and click/drag-to-seek, all without custom pointer-tracking or manual
`role="slider"`/keydown handling. It's styled thin via
`::-webkit-slider-runnable-track` / `::-moz-range-track` (well-worn CSS, no new
dependency).

This supersedes the 019 spec assumption that seek/volume "follow ordinary
browser video player conventions; no further custom player behavior is
specified" — `specs/019-video-upload/spec.md` will be updated to reflect that a
custom seek control now exists.

- `value`/`max` driven by `currentTime`/`duration`, read from the video's native
  `timeupdate` / `loadedmetadata` events (no polling).
- `onInput`/`onChange` sets `video.currentTime` directly — no debouncing needed;
  native range dragging already coalesces input events.

## Visibility: hover-reveal, slow fade-out

A new hook, `useVideoControlsVisibility(wrapperRef)`, mirrors the existing
one-hook-per-concern style of `useVideoAutoplay`. It returns a `visible` boolean
and wires up:

- **Desktop (hover):** `mouseenter` on the video wrapper shows the overlay;
  `mouseleave` starts the fade-out.
- **Touch (no hover event):** a tap on the video toggles the overlay visible; a
  timer auto-hides it after ~3s of inactivity, canceled/reset while a control is
  actively being interacted with (e.g. dragging the scrub bar).
- **Keyboard:** focus entering any control (`focusin`) keeps the overlay
  visible; `focusout` past the last control releases it back to the hover/tap
  rule.

CSS transitions `opacity` on `.meme-media__video-controls`: fast fade-in
(~100ms) when shown, slow fade-out (~600ms) when hidden — driven by a
visibility-derived class rather than pure `:hover`, since touch/keyboard need
JS-driven show/hide too.

## Accessibility

Icon buttons keep an accessible name via `aria-label` ("Unmute"/"Mute",
"Play"/"Pause") since they're now icon-only with no visible text label
(Constitution Principle IV/VIII — color/shape alone is never sufficient). The
range input gets `aria-label="Seek"`; native range semantics announce
current/max value to assistive tech without extra ARIA.

## Testing

Extends existing Vitest coverage of `VideoMedia`:
- Scrub input changes call `video.currentTime` with the expected value.
- The visibility hook's show/hide transitions: hover in/out, touch tap toggle,
  focus in/out, and the auto-hide timer (fake timers).
- Existing mute/pause toggle tests continue to pass against the icon buttons
  (assert on `aria-label`, not button text).

## Out of scope

- Volume level control (only mute/unmute, per existing 019 assumption).
- Fullscreen, playback speed, captions — unchanged, out of scope.
- Any change to `useVideoAutoplay`'s scroll-based play/pause logic.
