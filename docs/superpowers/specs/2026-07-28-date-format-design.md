# ISO date format everywhere, plus time on comments — design

**Date:** 2026-07-28
**Status:** approved
**Scope:** frontend presentation only. No API change, no schema change, no new dependency.

## Problem

Displayed dates are inconsistent across the site. The admin consoles render
`2026-07-22`, but the post byline and the comment list render `Jul 22, 2026`.
Comments show only a calendar day, which is too coarse for a discussion thread
where several comments routinely land on the same date.

## Goal

1. Every displayed date uses the ISO calendar format `yyyy-mm-dd`.
2. The comment list additionally shows the time as `hh:mm` (24-hour, zero-padded).

## Current state

| Surface | Renders | Source |
| --- | --- | --- |
| Post byline (feed items + post page) | `Jul 22, 2026` | `PostDate.format` via `PostByline` |
| Comment list | `Jul 23, 2026` | `PostDate.format` via `CommentItem` |
| Moderation console | `2026-07-08` | `ModerationModel.dateOnly` |
| Account console (Created, Disabled) | `2026-07-18` | `UserAdminModel.dateOnly` / `disabledSummary` |
| Account page | no dates | — |

`PostDate` is the only non-conforming formatter. The two admin models slice the
first 10 characters off the raw `Y-m-d H:i:s` string the admin resources send, so
they already emit `yyyy-mm-dd`.

## Design

### 1. `lib/postDate.ts` — one module, two methods

```ts
PostDate.format(iso)         // '2026-07-22'        (was 'Jul 22, 2026')
PostDate.formatWithTime(iso) // '2026-07-22 14:05'  (new)
```

The null contract is unchanged and applies to both methods: `null`, `''`, and any
unparseable string return `null`, so a caller can omit the element rather than
print `Invalid Date`.

`formatWithTime` composes: it calls `format` for the date half and appends
`` ` ${hh}:${mm}` ``, so the two methods cannot drift apart.

### 2. Drop `Intl.DateTimeFormat`; assemble from local `Date` getters

`Intl` was introduced (2026-07-22, uploader byline) only to *pin* the format
against browser-locale drift. Manual assembly with `padStart` serves that same
purpose more directly, and `Intl` cannot produce the target shape cleanly:

- `en-CA` yields `2026-07-22, 2:05 p.m.` — the comma and `p.m.` require
  `formatToParts` surgery.
- `sv-SE` happens to yield `2026-07-22 14:05`, but that is an accident of CLDR
  data, not a contract we should depend on.

Ten lines of `getFullYear` / `getMonth` / `getDate` / `getHours` / `getMinutes`
with zero-padding are provably identical on every browser, in Node, and in CI.
This **removes** a platform-API dependency; it adds nothing (Principle I).

Timezone behaviour is deliberately **unchanged**: the local-zone getters keep
rendering the visitor's own calendar day and clock, which is the conventional
"posted at" behaviour for a social feed.

### 3. Call sites

- `components/PostByline.tsx` — **no code change.** It already calls
  `PostDate.format` and picks up the new output. Renders `by alice · 2026-07-22`.
- `components/comments/CommentItem.tsx` — one line: `PostDate.format` →
  `PostDate.formatWithTime`. Renders `2026-07-22 14:05` in `.comment__date`.
- `styles/theme.css` — no change. `.comment__date` sets only font-size and colour;
  the comment header is a flex row that absorbs the ~6 extra characters.

### 4. Out of scope (deliberate)

- **The admin consoles are untouched.** They already emit `yyyy-mm-dd`, and their
  cell tooltips already expose the full `Y-m-d H:i:s`.
- **The UTC-vs-local discrepancy stays.** Admin cells show server (UTC) time
  because they slice a server-formatted string; the byline and comments show
  viewer-local time because they parse an ISO instant. This predates the change
  and unifying it is a separate decision with its own trade-offs.
- **The byline does not gain a time.** Time was requested for the comment list
  specifically; the feed stays uncluttered.

## Testing

TDD: each assertion is written to fail against the current `Jul 22, 2026` output
before the formatter changes.

### Timezone determinism (a real hazard, not a hypothetical)

Existing tests assert local-zone output from UTC inputs — `2026-07-22T12:00:00Z`
→ `Jul 22, 2026`. That survives today only because a whole-day granularity hides
the offset. Once minutes are displayed, `CommentItem`'s `2026-07-23T10:15:00Z`
renders `13:15` on a UTC+3 developer machine and `10:15` on a UTC CI runner — a
guaranteed split between local and CI.

The fix is to **remove the coupling, not mask it**: every timestamp fixture uses a
**zone-less ISO date-time** (`'2026-07-22T14:05:00'`, no `Z`). Per ECMA-262 those
parse as *local* time, so the input and the expected output share a frame and the
assertion holds in any timezone. (A date-*only* string like `'2026-07-22'` parses
as UTC, so fixtures must always carry a time component.)

`TZ=UTC` is still pinned via `test.env` in `frontend/vite.config.ts` as a safety
net for future fixtures, but it is deliberately **not load-bearing**. During
implementation it was observed failing once — `formatWithTime` returned UTC+3
output despite the pin — and then was not reproducible across 10 further runs.
Live config edits *are* picked up (verified by temporarily switching the pin to
`America/New_York` and seeing the output move), which rules out a stale config
cache; the likely cause is that assigning `process.env.TZ` inside a Vitest worker
thread does not always reset Node's timezone cache. An intermittent mechanism is
not a foundation, hence the zone-less fixtures above.

The four fixtures that actually flow through `new Date()` were converted
(`postDate`, `PostByline`, `FeedItem`, `PostPage`, `CommentItem`). Other `...Z`
fixtures in the suite are pass-through payload data or are asserted as raw
strings — the admin models slice the string and never parse it — so they are
timezone-independent by construction and were left alone.

### Assertions

- `tests/lib/postDate.test.ts` — both methods: a normal instant; zero-padding for
  single-digit month, day, hour, and minute; midnight (`00:00`); and `null` for
  `null` / `''` / `'not a date'`.
- `tests/components/PostByline.test.tsx`, `tests/components/FeedItem.test.tsx`,
  `tests/pages/PostPage.test.tsx` — the `Jul 22, 2026` matchers become
  `2026-07-22`.
- `tests/components/comments/CommentItem.test.tsx` — the `Jul 23, 2026` matcher
  becomes `2026-07-23 10:15`.

Coverage stays above the 90% line gate; the changed module is fully exercised by
its own unit test.

## Constitution check

- **I — Minimal dependencies:** nothing added; an `Intl` usage removed.
- **II — Separation:** formatting stays a pure `lib/` class of static methods; no
  IO, no React.
- **IV — Theming & a11y:** text-only change; no colour carries meaning, and the
  date remains plain text in the same element.
- **VII — Tests mirror source:** `src/lib/postDate.ts` →
  `tests/lib/postDate.test.ts`, already in place.
