# ISO Date Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every displayed date as `yyyy-mm-dd`, and show `yyyy-mm-dd hh:mm` on the comment list.

**Architecture:** All non-conforming output comes from one module, `frontend/src/lib/postDate.ts`. It stops using `Intl.DateTimeFormat` and instead assembles the string from zero-padded local `Date` getters, which pins the format deterministically across browsers, Node, and CI. A second method, `formatWithTime`, composes on top of `format` and is used only by the comment list. The admin consoles already emit `yyyy-mm-dd` and are not touched.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`vitest run`), @testing-library/react with the jsdom environment.

**Design spec:** `docs/superpowers/specs/2026-07-28-date-format-design.md`

## Global Constraints

- **No new dependencies** (Constitution Principle I). This change adds nothing and *removes* an `Intl` usage. Do not reach for `date-fns`, `dayjs`, `luxon`, or any other date library.
- **Coding conventions** (`docs/CODING_CONVENTIONS.md`, binding): 2-space indent, semicolons, single quotes, braces on single-line bodies, functions under 50 lines, comments explain *why* not *what*.
- **`lib/` modules are a single class of `static` methods.** Call through the class (`PostDate.format`), never re-introduce loose exported functions.
- **Tests mirror source** (Principle VII): `src/lib/postDate.ts` → `tests/lib/postDate.test.ts`.
- **Coverage gate ≥90% lines** over all of `src/`, enforced in CI.
- **Timezone for display is the viewer's local zone** — unchanged behaviour. Do not add a `timeZone` option or switch to `getUTC*` getters.
- **Working directory:** run every `npx` / `npm` command from `frontend/`, and every `git` command from the repo root (the `git add` paths in this plan are repo-relative). Host Node (v24) and `node_modules` are present, so `npx vitest` runs directly — no Docker needed for the frontend (unlike the backend).
- **Commit on the current branch** (`master`). Do not create a branch or worktree.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `frontend/vite.config.ts` | Modify | Add `test.env.TZ = 'UTC'` so timestamp assertions are deterministic in CI and locally. |
| `frontend/src/lib/postDate.ts` | Rewrite | The single date-formatting class: `format` → `yyyy-mm-dd`, `formatWithTime` → `yyyy-mm-dd hh:mm`. |
| `frontend/tests/lib/postDate.test.ts` | Modify | Unit tests for both methods: normal case, zero-padding, midnight, null contract. |
| `frontend/tests/components/PostByline.test.tsx` | Modify | Swap the `Jul 22, 2026` matcher. |
| `frontend/tests/components/FeedItem.test.tsx` | Modify | Swap the `Jul 22, 2026` matcher. |
| `frontend/tests/pages/PostPage.test.tsx` | Modify | Swap the `Jul 22, 2026` matcher. |
| `frontend/src/components/comments/CommentItem.tsx` | Modify | Call `formatWithTime` instead of `format`. |
| `frontend/tests/components/comments/CommentItem.test.tsx` | Modify | Assert the date *and* time. |

`frontend/src/components/PostByline.tsx` is **not** modified — it already calls `PostDate.format` and inherits the new output. `frontend/src/styles/theme.css` is **not** modified — `.comment__date` sets only font-size and colour, and the header is a flex row.

---

### Task 1: `PostDate.format` emits `yyyy-mm-dd`

Pins the test timezone (needed by this task's assertions and Task 2's), converts the formatter, and updates the three component tests that assert the old string.

**Files:**
- Modify: `frontend/vite.config.ts:20-31`
- Modify: `frontend/src/lib/postDate.ts` (full rewrite)
- Test: `frontend/tests/lib/postDate.test.ts`
- Test: `frontend/tests/components/PostByline.test.tsx:14`
- Test: `frontend/tests/components/FeedItem.test.tsx:64`
- Test: `frontend/tests/pages/PostPage.test.tsx:159`

**Interfaces:**
- Consumes: nothing.
- Produces: `PostDate.format(iso: string | null): string | null` — returns `'2026-07-22'` for a valid ISO instant (rendered in the runtime's local zone), `null` for `null` / `''` / unparseable input. Task 2 builds `formatWithTime` on top of this exact signature.

- [ ] **Step 1: Pin the test timezone**

Why first: the existing assertions below feed UTC instants into a local-zone formatter. Today a whole-day granularity hides the offset; Task 2 displays minutes and would split between a UTC+3 dev machine and a UTC CI runner. Pinning removes the whole class of flake.

In `frontend/vite.config.ts`, inside the existing `test: { ... }` block, add the `env` key immediately above `coverage`:

```ts
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Date output is rendered in the runtime's local zone (PostDate uses local getters,
    // by design). Without pinning, a timestamp assertion would pass on a UTC+3 dev
    // machine and fail on the UTC CI runner. UTC makes every assertion deterministic.
    env: { TZ: 'UTC' },
    coverage: {
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `frontend/tests/lib/postDate.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { PostDate } from '../../src/lib/postDate';

// The suite runs with TZ=UTC pinned in vite.config.ts, so these instants render as written.
describe('PostDate.format', () => {
  it('formats an ISO timestamp as an ISO calendar date', () => {
    expect(PostDate.format('2026-07-22T12:00:00Z')).toBe('2026-07-22');
  });

  it('zero-pads a single-digit month and day', () => {
    expect(PostDate.format('2026-01-05T12:00:00Z')).toBe('2026-01-05');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.format(null)).toBeNull();
    expect(PostDate.format('')).toBeNull();
    expect(PostDate.format('not a date')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/lib/postDate.test.ts`
Expected: FAIL — `expected 'Jul 22, 2026' to be '2026-07-22'`.

- [ ] **Step 4: Rewrite the formatter**

Replace the whole of `frontend/src/lib/postDate.ts` with:

```ts
// Formats a post's creation timestamp for the byline and the comment list. In-house
// (no date library, Principle I) and no Intl either: Intl was only ever pinning the
// format against browser-locale drift, and it cannot produce 'yyyy-mm-dd hh:mm' without
// formatToParts surgery. Padded local getters give the same guarantee in ten lines.
export class PostDate {
  // Timezone is intentionally the viewer's local zone (local getters, not getUTC*), so the
  // displayed day and clock are the visitor's own — the conventional "posted at" behaviour
  // for a social feed.
  static format(iso: string | null): string | null {
    const date = PostDate.parse(iso);
    return date === null ? null : PostDate.datePart(date);
  }

  // Null for null/blank/unparseable input so callers can omit the element entirely rather
  // than print 'Invalid Date'.
  private static parse(iso: string | null): Date | null {
    if (!iso) {
      return null;
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private static datePart(date: Date): string {
    const month = PostDate.pad(date.getMonth() + 1);
    return `${date.getFullYear()}-${month}-${PostDate.pad(date.getDate())}`;
  }

  private static pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx vitest run tests/lib/postDate.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Update the three component assertions**

These now fail because they still expect the old string. Change one line in each file:

`frontend/tests/components/PostByline.test.tsx:14`
```tsx
    expect(screen.getByText(/2026-07-22/)).toBeTruthy();
```

`frontend/tests/components/FeedItem.test.tsx:64`
```tsx
    expect(screen.getByText(/2026-07-22/)).toBeTruthy();
```

`frontend/tests/pages/PostPage.test.tsx:159`
```tsx
    expect(screen.getByText(/2026-07-22/)).toBeTruthy();
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS, except `tests/components/comments/CommentItem.test.tsx` — its `/Jul 23, 2026/` matcher now fails. That is Task 2's territory; if any *other* test fails, stop and diagnose before continuing.

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.config.ts frontend/src/lib/postDate.ts frontend/tests/lib/postDate.test.ts frontend/tests/components/PostByline.test.tsx frontend/tests/components/FeedItem.test.tsx frontend/tests/pages/PostPage.test.tsx
git commit -m "feat(dates): render post dates as yyyy-mm-dd"
```

---

### Task 2: The comment list shows `yyyy-mm-dd hh:mm`

**Files:**
- Modify: `frontend/src/lib/postDate.ts` (add one method)
- Modify: `frontend/src/components/comments/CommentItem.tsx:32`
- Test: `frontend/tests/lib/postDate.test.ts` (add a describe block)
- Test: `frontend/tests/components/comments/CommentItem.test.tsx:62-65`

**Interfaces:**
- Consumes: `PostDate.format(iso: string | null): string | null` from Task 1.
- Produces: `PostDate.formatWithTime(iso: string | null): string | null` — `'2026-07-22 14:05'`, or `null` on the same null/blank/unparseable inputs as `format`.

- [ ] **Step 1: Write the failing unit tests**

Append to `frontend/tests/lib/postDate.test.ts`, after the existing `describe('PostDate.format', ...)` block:

```ts
describe('PostDate.formatWithTime', () => {
  it('appends a 24-hour clock to the ISO date', () => {
    expect(PostDate.formatWithTime('2026-07-22T14:05:00Z')).toBe('2026-07-22 14:05');
  });

  it('zero-pads a single-digit hour and minute', () => {
    expect(PostDate.formatWithTime('2026-07-22T09:07:00Z')).toBe('2026-07-22 09:07');
  });

  it('renders midnight as 00:00 rather than 24:00 or 12:00 AM', () => {
    expect(PostDate.formatWithTime('2026-07-22T00:00:00Z')).toBe('2026-07-22 00:00');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.formatWithTime(null)).toBeNull();
    expect(PostDate.formatWithTime('')).toBeNull();
    expect(PostDate.formatWithTime('not a date')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/postDate.test.ts`
Expected: FAIL — `PostDate.formatWithTime is not a function`.

- [ ] **Step 3: Add the method**

In `frontend/src/lib/postDate.ts`, insert `formatWithTime` directly after `format` (keeping the private helpers below it):

```ts
  // The comment list needs minute precision — several comments routinely land on the same
  // day. Shares datePart() with format(), so the date half can never drift from the byline's.
  static formatWithTime(iso: string | null): string | null {
    const date = PostDate.parse(iso);
    if (date === null) {
      return null;
    }
    return `${PostDate.datePart(date)} ${PostDate.timePart(date)}`;
  }
```

Then add `timePart` alongside the other private helpers, directly after `datePart`:

```ts
  private static timePart(date: Date): string {
    return `${PostDate.pad(date.getHours())}:${PostDate.pad(date.getMinutes())}`;
  }
```

Note it shares the parsed `Date` rather than re-calling `format(iso)`: that avoids parsing twice, and avoids feeding `format`'s `string | null` return into a template literal (which would satisfy the compiler but trip ESLint's `restrict-template-expressions` and could silently print `"null"`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/postDate.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Update the CommentItem test**

In `frontend/tests/components/comments/CommentItem.test.tsx`, replace the test at lines 62-65 with:

```tsx
  it('renders the formatted post date and time', () => {
    renderItem({ createdAt: '2026-07-23T10:15:00.000000Z' });
    expect(screen.getByText('2026-07-23 10:15')).toBeTruthy();
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/components/comments/CommentItem.test.tsx`
Expected: FAIL — the element's text is `2026-07-23` (Task 1's output), with no time.

- [ ] **Step 7: Wire the component**

In `frontend/src/components/comments/CommentItem.tsx:32`:

```tsx
  const date = PostDate.formatWithTime(comment.createdAt);
```

Leave the surrounding JSX alone — `{date ? <span className="comment__date">{date}</span> : null}` already handles the null case.

- [ ] **Step 8: Run the full suite with coverage**

Run: `npx vitest run --coverage`
Expected: PASS, all files, with the line threshold of 90% met.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/postDate.ts frontend/src/components/comments/CommentItem.tsx frontend/tests/lib/postDate.test.ts frontend/tests/components/comments/CommentItem.test.tsx
git commit -m "feat(comments): show the comment time alongside the date"
```

---

## Verification

Before claiming completion, run and read the output of all three:

```bash
npx vitest run --coverage   # all tests pass, lines >= 90%
npm run lint                # clean
npx tsc -b --noEmit         # no type errors
```

Then confirm in the running app (`docker compose restart frontend` if Vite is serving stale code after a checkout):
- Feed item and post page byline read `by <name> · 2026-07-22`.
- A comment header reads `<name>  2026-07-22 14:05`.
- `/admin/trashposts` and `/admin/users` are unchanged (already `yyyy-mm-dd`).
