# Video Control Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the video post's always-visible text buttons ("Unmute"/"Mute", "Play"/"Pause") with icon buttons at the bottom-left, add a full-width seek/scrub bar, and make the whole overlay fade in on hover/tap/focus and fade out slowly when the pointer leaves.

**Architecture:** All changes live in the existing `VideoMedia` sub-component of `frontend/src/components/MemeMedia.tsx`, plus one new hook (`useVideoTapToggle`) for the touch-tap-to-reveal-then-auto-hide behavior, plus CSS additions in `frontend/src/styles/theme.css`. Desktop hover and keyboard focus are handled entirely in CSS (`:hover`, `:focus-within`) — no JS state needed for those two paths, which keeps the new hook scoped to the one thing CSS can't do (a tap toggle with a timed auto-hide). This is a refinement of the approved design doc's single "does everything" hook into CSS-first + a narrow hook; the observable behavior (hover shows/fades slowly, tap toggles + auto-hides after ~3s, keyboard focus keeps it visible) is unchanged from what was approved.

**Tech Stack:** React 18 + TypeScript (frontend/), Vitest + @testing-library/react for tests, no new dependency.

## Global Constraints

- No new npm dependency (Constitution Principle I / minimal dependencies).
- 2-space TS, semicolons, braces required on every single-line body, opening braces on the same line (`docs/CODING_CONVENTIONS.md`).
- Functions under 50 lines; extract helpers if longer.
- `lib/` stays one-class-of-static-methods style; this plan touches only `components/` and `hooks/`, which stay as functions (React convention, `CLAUDE.md`).
- Icon-only buttons need an accessible name via `aria-label`; the icon itself is `aria-hidden="true"` decorative (Constitution Principle IV/VIII — color/shape is never the sole signal).
- Tests mirror source paths under `frontend/tests/` (Constitution Principle VII): `src/hooks/useVideoTapToggle.ts` → `tests/hooks/useVideoTapToggle.test.tsx`.
- Frontend coverage gate is ≥90% Clover across all of `src/` (CI `check_coverage.py`), so every new branch (tap toggle on/off, auto-hide timeout, seek) needs a test.
- Run frontend tests with `cd frontend && npm test`, lint with `npm run lint` (no Docker needed for the frontend stack).

---

## File Structure

- **Create** `frontend/src/hooks/useVideoTapToggle.ts` — the tap-to-reveal/auto-hide hook. One responsibility: touch/click toggling of a boolean, with a self-clearing timeout.
- **Create** `frontend/tests/hooks/useVideoTapToggle.test.tsx` — tests for that hook in isolation.
- **Modify** `frontend/src/components/MemeMedia.tsx` — `VideoMedia`: icon glyphs, icon buttons, scrub bar (duration/currentTime state + seek), wrapper class wiring for the tap-visible state.
- **Modify** `frontend/tests/components/MemeMedia.test.tsx` — add scrub-bar and tap-visibility tests; existing mute/pause tests are expected to keep passing unchanged (they already query by accessible name, which stays the same string, just now sourced from `aria-label` instead of button text).
- **Modify** `frontend/src/styles/theme.css` — replace the always-visible text-chip styling with icon-button + scrub-bar + fade-in/out styling.
- **Modify** `specs/019-video-upload/spec.md` — update the assumptions bullet that said seek/volume "follow ordinary browser video player conventions; no further custom player behavior is specified" to reflect that a scrub bar now exists.

---

### Task 1: `useVideoTapToggle` hook

**Files:**
- Create: `frontend/src/hooks/useVideoTapToggle.ts`
- Test: `frontend/tests/hooks/useVideoTapToggle.test.tsx`

**Interfaces:**
- Produces: `useVideoTapToggle(): { tapVisible: boolean; toggleTapVisible: () => void }` — `tapVisible` starts `false`; each call to `toggleTapVisible` flips it; going `true` schedules an auto-hide back to `false` after `AUTO_HIDE_MS`; going `false` (whether by a second tap or the timeout) clears any pending timer.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/hooks/useVideoTapToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoTapToggle } from '../../src/hooks/useVideoTapToggle';

function Harness() {
  const { tapVisible, toggleTapVisible } = useVideoTapToggle();
  return (
    <button type="button" onClick={toggleTapVisible} data-visible={tapVisible}>
      {tapVisible ? 'visible' : 'hidden'}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useVideoTapToggle', () => {
  it('starts hidden', () => {
    const { getByRole } = render(<Harness />);

    expect(getByRole('button').textContent).toBe('hidden');
  });

  it('shows on the first toggle and hides on the second', () => {
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => button.click());
    expect(button.textContent).toBe('hidden');
  });

  it('auto-hides a few seconds after becoming visible', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click());
    expect(button.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(3000));
    expect(button.textContent).toBe('hidden');
  });

  it('does not fire a stale auto-hide after a manual re-toggle', () => {
    vi.useFakeTimers();
    const { getByRole } = render(<Harness />);
    const button = getByRole('button');

    act(() => button.click()); // visible, timer A scheduled
    act(() => vi.advanceTimersByTime(1000));
    act(() => button.click()); // hidden, timer A cleared
    act(() => button.click()); // visible again, timer B scheduled fresh

    // Only 2000ms since timer B started — timer A (which would have fired at the
    // 3000ms mark from the first click) must not have fired early.
    act(() => vi.advanceTimersByTime(2000));
    expect(button.textContent).toBe('visible');

    act(() => vi.advanceTimersByTime(1000));
    expect(button.textContent).toBe('hidden');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useVideoTapToggle.test.tsx`
Expected: FAIL — `Cannot find module '../../src/hooks/useVideoTapToggle'`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/useVideoTapToggle.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

const AUTO_HIDE_MS = 3000;

// Touch devices have no hover event, so the video control overlay (MemeMedia's VideoMedia)
// needs a tap-driven reveal instead: a tap toggles the overlay, and showing it starts a timer
// that hides it again after a few seconds of inactivity. Desktop hover and keyboard focus are
// handled in CSS (:hover / :focus-within) — this hook only covers the tap path.
export function useVideoTapToggle(): { tapVisible: boolean; toggleTapVisible: () => void } {
  const [tapVisible, setTapVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); }
    };
  }, []);

  const toggleTapVisible = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setTapVisible((value) => {
      const next = !value;
      if (next) {
        timeoutRef.current = setTimeout(() => setTapVisible(false), AUTO_HIDE_MS);
      }
      return next;
    });
  }, []);

  return { tapVisible, toggleTapVisible };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useVideoTapToggle.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useVideoTapToggle.ts frontend/tests/hooks/useVideoTapToggle.test.tsx
git commit -m "feat(019): add tap-to-reveal/auto-hide hook for video controls"
```

---

### Task 2: Icon buttons for mute and play/pause

**Files:**
- Modify: `frontend/src/components/MemeMedia.tsx:1-66` (imports, `VideoMedia`)
- Test: `frontend/tests/components/MemeMedia.test.tsx`

**Interfaces:**
- Consumes: nothing new yet (Task 1's hook is wired in Task 4).
- Produces: `VideoGlyph({ name }: { name: 'play' | 'pause' | 'mute' | 'unmute' })` — a local decorative-SVG component other tasks don't need to import (stays private to `MemeMedia.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/components/MemeMedia.test.tsx`, inside the `describe('MemeMedia', ...)` block (after the existing `'exposes the unmute and pause controls...'` test):

```tsx
  it('renders the mute and play controls as icon-only buttons with no visible text', () => {
    render(<MemeMedia media={videoMedia} />);

    const unmuteBtn = screen.getByRole('button', { name: 'Unmute' });
    const playBtn = screen.getByRole('button', { name: 'Play' });
    expect(unmuteBtn.textContent).toBe('');
    expect(playBtn.textContent).toBe('');
    expect(unmuteBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(playBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx -t "icon-only buttons"`
Expected: FAIL — `unmuteBtn.textContent` is `"Unmute"`, not `""`.

- [ ] **Step 3: Implement icon buttons**

In `frontend/src/components/MemeMedia.tsx`, add the glyph map and `VideoGlyph` component after the existing imports (after line 9, before `toggleMuted`):

```tsx
// Flat 24x24 currentColor path glyphs, same style as moderation/ActionGlyph.tsx's play/pause
// shapes (play/pause paths are identical); mute/unmute are the standard Material Design
// volume_off/volume_up glyphs. Decorative only — the button's aria-label carries the
// accessible name (Principle IV).
const VIDEO_CONTROL_GLYPHS: Record<'play' | 'pause' | 'mute' | 'unmute', string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  unmute:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute:
    'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
};

function VideoGlyph({ name }: { name: keyof typeof VIDEO_CONTROL_GLYPHS }) {
  return (
    <svg className="meme-media__video-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={VIDEO_CONTROL_GLYPHS[name]} />
    </svg>
  );
}
```

Replace the two `<button>` elements (current lines 57-62) with:

```tsx
        <button
          type="button"
          className="meme-media__video-btn"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={() => toggleMuted(setMuted)}
        >
          <VideoGlyph name={muted ? 'unmute' : 'mute'} />
        </button>
        <button
          type="button"
          className="meme-media__video-btn"
          aria-label={paused ? 'Play' : 'Pause'}
          onClick={() => togglePlayback(videoRef)}
        >
          <VideoGlyph name={paused ? 'play' : 'pause'} />
        </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx`
Expected: PASS — the new test passes, and every pre-existing test in this file still passes
unchanged (they query by accessible name, which is unchanged text, now via `aria-label`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MemeMedia.tsx frontend/tests/components/MemeMedia.test.tsx
git commit -m "feat(019): replace video overlay text buttons with icon buttons"
```

---

### Task 3: Scrub bar (seek)

**Files:**
- Modify: `frontend/src/components/MemeMedia.tsx` (`VideoMedia`)
- Test: `frontend/tests/components/MemeMedia.test.tsx`

**Interfaces:**
- Consumes: `videoRef` (already in scope in `VideoMedia`).
- Produces: nothing new consumed elsewhere — the scrub bar is local to `VideoMedia`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/components/MemeMedia.test.tsx`:

```tsx
  it('the scrub bar reflects duration and current time as the video plays', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const scrub = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement;

    expect(scrub.value).toBe('0');

    Object.defineProperty(video, 'duration', { value: 120, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(scrub.max).toBe('120');

    Object.defineProperty(video, 'currentTime', { value: 30, configurable: true, writable: true });
    fireEvent.timeUpdate(video);
    expect(scrub.value).toBe('30');
  });

  it('dragging the scrub bar seeks the video', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { value: 0, configurable: true, writable: true });
    const scrub = screen.getByRole('slider', { name: 'Seek' });

    fireEvent.change(scrub, { target: { value: '45' } });

    expect(video.currentTime).toBe(45);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx -t "scrub"`
Expected: FAIL — `getByRole('slider', { name: 'Seek' })` finds no element.

- [ ] **Step 3: Implement the scrub bar**

In `frontend/src/components/MemeMedia.tsx`, add a `seekTo` helper next to `togglePlayback`:

```tsx
function seekTo(videoRef: RefObject<HTMLVideoElement | null>, time: number): void {
  const video = videoRef.current;
  if (!video) { return; }
  video.currentTime = time;
}
```

Add `CSSProperties` to the existing type-only import at the top of the file (the codebase
convention here is named type imports from `'react'`, not the `React.X` namespace form — see
e.g. `RefObject` already imported the same way):

```tsx
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';
```

Add a local style type above `VideoMedia` (a bare `as CSSProperties` cast on an object literal
with a custom property errors under this project's `@types/react`, which has no `--${string}`
index signature — this intersection type sidesteps that):

```tsx
type ScrubStyle = CSSProperties & { '--video-progress'?: string };
```

In `VideoMedia`, add duration/currentTime state and the video event handlers:

```tsx
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
```

On the `<video>` element, add two handlers (alongside the existing `onPlay`/`onPause`):

```tsx
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
```

Below the two icon buttons, still inside `.meme-media__video-controls`, add the scrub input:

```tsx
        <input
          type="range"
          className="meme-media__video-scrub"
          aria-label="Seek"
          min={0}
          max={duration}
          step="any"
          value={currentTime}
          onChange={(event) => seekTo(videoRef, Number(event.target.value))}
          style={{ '--video-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as ScrubStyle}
        />
```

The `min={0} max={duration}` attributes above render fine with `duration` starting at `0`
(no `NaN` risk — `useState(0)`'s initial value, not `video.duration`, which can be `NaN` before
metadata loads).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx`
Expected: PASS — all tests in the file, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MemeMedia.tsx frontend/tests/components/MemeMedia.test.tsx
git commit -m "feat(019): add a seek scrub bar to the video overlay"
```

---

### Task 4: Hover/tap/focus fade overlay + CSS

**Files:**
- Modify: `frontend/src/components/MemeMedia.tsx` (`VideoMedia`)
- Modify: `frontend/src/styles/theme.css:396-444`
- Test: `frontend/tests/components/MemeMedia.test.tsx`

**Interfaces:**
- Consumes: `useVideoTapToggle()` from Task 1 (`{ tapVisible, toggleTapVisible }`).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/components/MemeMedia.test.tsx` (needs `vi` already imported):

```tsx
  it('a tap on the video reveals the controls overlay and auto-hides it a few seconds later', () => {
    vi.useFakeTimers();
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const wrap = container.querySelector('.meme-media--video-wrap') as HTMLElement;

    expect(wrap.classList.contains('meme-media--controls-visible')).toBe(false);

    fireEvent.click(video);
    expect(wrap.classList.contains('meme-media--controls-visible')).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(wrap.classList.contains('meme-media--controls-visible')).toBe(false);
    vi.useRealTimers();
  });

  it('a second tap on the video hides the overlay immediately', () => {
    const { container } = render(<MemeMedia media={videoMedia} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const wrap = container.querySelector('.meme-media--video-wrap') as HTMLElement;

    fireEvent.click(video);
    expect(wrap.classList.contains('meme-media--controls-visible')).toBe(true);

    fireEvent.click(video);
    expect(wrap.classList.contains('meme-media--controls-visible')).toBe(false);
  });
```

`afterEach` in this file already calls `vi.restoreAllMocks()` but not `vi.useRealTimers()`
unconditionally — add it there too so a failed fake-timers test can't leak into the next one:

```tsx
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx -t "tap on the video"`
Expected: FAIL — `.meme-media--controls-visible` never gets added (no click handler on `<video>` yet).

- [ ] **Step 3: Wire the hook and CSS**

In `frontend/src/components/MemeMedia.tsx`, import the hook and use it in `VideoMedia`:

```tsx
import { useVideoTapToggle } from '../hooks/useVideoTapToggle';
```

```tsx
  const { tapVisible, toggleTapVisible } = useVideoTapToggle();
```

Change the outer `<div>`'s className and add the click handler to `<video>` — the opening tags
of both elements should now read:

```tsx
    <div
      className={`meme-media meme-media--video-wrap${tapVisible ? ' meme-media--controls-visible' : ''}`}
    >
      <video
        ref={videoRef}
        className="meme-media__video"
        poster={media.src}
        muted={muted}
        playsInline
        loop
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
        onClick={toggleTapVisible}
        width={media.width}
        height={media.height}
      >
```

In `frontend/src/styles/theme.css`, replace lines 405-438 (the `.meme-media--video-wrap`
comment through the end of `.meme-media__video-btn:hover, :focus-visible`) with:

```css
/* Positions the mute/play/scrub overlay against the video underneath it (US3, FR-008).
   Desktop hover and keyboard focus reveal it via :hover / :focus-within below; touch has
   no hover event, so MemeMedia also toggles the --controls-visible modifier on tap
   (useVideoTapToggle), which auto-clears itself a few seconds after a tap reveals it. */
.meme-media--video-wrap {
  position: relative;
}

.meme-media__video-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm) var(--space-sm);
  opacity: 0;
  /* Slow fade-out: this is the resting state a hover/tap/focus reveal transitions back to. */
  transition: opacity 600ms ease-out;
}

.meme-media--video-wrap:hover .meme-media__video-controls,
.meme-media--video-wrap:focus-within .meme-media__video-controls,
.meme-media--video-wrap.meme-media--controls-visible .meme-media__video-controls {
  opacity: 1;
  /* Fast fade-in: this rule's transition governs entering the visible state. */
  transition: opacity 100ms ease-in;
}

.meme-media__video-buttons {
  display: flex;
  gap: var(--space-xs);
  align-self: flex-start;
}

/* A translucent chip over the video frame, not the page background, so a fixed
   white-on-black contrast reads correctly regardless of the site's light/dark scheme —
   unlike the token-driven controls elsewhere, this one never sits on --color-surface. */
.meme-media__video-btn {
  width: 2.25rem;
  height: 2.25rem;
  min-width: 2.25rem;
  min-height: 2.25rem; /* comfortable touch target (Principle VIII). */
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background-color: rgb(0 0 0 / 55%);
  border: 1px solid rgb(255 255 255 / 40%);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.meme-media__video-btn:hover,
.meme-media__video-btn:focus-visible {
  background-color: rgb(0 0 0 / 75%);
}

.meme-media__video-icon {
  width: 1.25rem;
  height: 1.25rem;
  fill: currentColor;
}

/* Thin video-style scrub bar. The webkit track's two-tone gradient reads --video-progress
   (set inline per-frame from currentTime/duration); Firefox gets the same effect for free
   via ::-moz-range-progress, which fills automatically up to the current value. */
.meme-media__video-scrub {
  width: 100%;
  margin: 0;
  height: 0.9rem; /* generous hit area even though the visible track is thin (Principle VIII) */
  cursor: pointer;
  accent-color: #fff;
}

.meme-media__video-scrub::-webkit-slider-runnable-track {
  height: 0.25rem;
  border-radius: var(--radius-md);
  background: linear-gradient(
    to right,
    rgb(255 255 255 / 90%) var(--video-progress, 0%),
    rgb(255 255 255 / 30%) var(--video-progress, 0%)
  );
}

.meme-media__video-scrub::-webkit-slider-thumb {
  appearance: none;
  width: 0.75rem;
  height: 0.75rem;
  margin-top: -0.25rem;
  border-radius: 50%;
  background: #fff;
  border: 1px solid rgb(0 0 0 / 40%);
}

.meme-media__video-scrub::-moz-range-track {
  height: 0.25rem;
  border-radius: var(--radius-md);
  background: rgb(255 255 255 / 30%);
}

.meme-media__video-scrub::-moz-range-progress {
  height: 0.25rem;
  border-radius: var(--radius-md);
  background: rgb(255 255 255 / 90%);
}

.meme-media__video-scrub::-moz-range-thumb {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: #fff;
  border: 1px solid rgb(0 0 0 / 40%);
}
```

Finally, wrap the two `<button>` elements in a `.meme-media__video-buttons` div so the CSS
above (`align-self: flex-start` on that row, full-width scrub below it) applies. The full
`.meme-media__video-controls` block should now read:

```tsx
      <div className="meme-media__video-controls">
        <div className="meme-media__video-buttons">
          <button
            type="button"
            className="meme-media__video-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => toggleMuted(setMuted)}
          >
            <VideoGlyph name={muted ? 'unmute' : 'mute'} />
          </button>
          <button
            type="button"
            className="meme-media__video-btn"
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={() => togglePlayback(videoRef)}
          >
            <VideoGlyph name={paused ? 'play' : 'pause'} />
          </button>
        </div>
        <input
          type="range"
          className="meme-media__video-scrub"
          aria-label="Seek"
          min={0}
          max={duration}
          step="any"
          value={currentTime}
          onChange={(event) => seekTo(videoRef, Number(event.target.value))}
          style={{ '--video-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as ScrubStyle}
        />
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/MemeMedia.test.tsx`
Expected: PASS — full file, including both new tap-visibility tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MemeMedia.tsx frontend/src/styles/theme.css frontend/tests/components/MemeMedia.test.tsx
git commit -m "feat(019): fade the video overlay in on hover/tap/focus, out on leave"
```

---

### Task 5: Update the 019 spec assumption

**Files:**
- Modify: `specs/019-video-upload/spec.md:214-217`

- [ ] **Step 1: Edit the assumption**

Replace:

```markdown
- Beyond the required autoplay-muted/scroll-pause behavior and the
  unmute/pause control, playback controls (seek, volume level) follow
  ordinary browser video player conventions; no further custom player
  behavior is specified here.
```

with:

```markdown
- Beyond the required autoplay-muted/scroll-pause behavior, the video overlay
  provides mute/unmute, play/pause, and a scrub bar for seeking (added
  2026-08-06 — see
  docs/superpowers/specs/2026-08-06-video-control-overlay-design.md). Volume
  level, fullscreen, playback speed, and captions still follow ordinary
  browser conventions and remain out of scope.
```

- [ ] **Step 2: Commit**

```bash
git add specs/019-video-upload/spec.md
git commit -m "docs(019): note the custom scrub bar in the spec assumptions"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full frontend test suite with coverage**

Run: `cd frontend && npm test -- --coverage`
Expected: all tests pass; coverage on `src/components/MemeMedia.tsx`,
`src/hooks/useVideoTapToggle.ts` at or above the repo's ≥90% Clover gate.

- [ ] **Step 2: Run lint**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual check in a running dev server**

If the frontend dev server is already running (`docker compose` per `CLAUDE.md`), open a page
with a video post (feed or `/posts/{hash}`) and confirm: controls are hidden at rest, hovering
the video reveals icon buttons + scrub bar, moving the mouse away fades them out slowly,
clicking the mute/play icons still works, dragging the scrub bar seeks, and on a narrow/touch
viewport (DevTools device toolbar) tapping the video reveals the overlay and it fades after a
few seconds.

- [ ] **Step 4: Commit if Step 3 uncovered fixups**

Only if manual testing required changes:

```bash
git add -A
git commit -m "fix(019): address manual QA findings on the video control overlay"
```
