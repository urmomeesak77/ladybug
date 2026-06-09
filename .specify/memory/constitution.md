<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.1 → 1.2.0
Bump rationale (latest): MINOR — added Principle VIII (Responsive, Multi-Device Layout), a
new non-negotiable requirement that the site work across mobile, tablet, and desktop
viewports. Also corrected the footer Version line, which had remained at 1.1.0 after the
1.1.1 amendment. New principle added = MINOR bump.

History:
  - 1.0.0 (2026-06-08): Initial ratification — first concrete constitution replacing
    the unfilled template. Core Principles I–VI + supporting sections.
  - 1.1.0 (2026-06-08): Added Principle VII; added Test Gate; reworded manual-verification
    note (no longer claims "little automated test coverage").
  - 1.1.1 (2026-06-09): Clarified Principle V code format (10 chars, `[A-Za-z0-9-_]`) and
    fixed the contradicting length/charset reference in Technology & Architecture
    Constraints. Wording/consistency fix only.
  - 1.2.0 (2026-06-09): Added Principle VIII (Responsive, Multi-Device Layout); extended the
    Manual verification gate and Technology & Architecture Constraints to cover responsive
    behavior; corrected the stale footer Version line (1.1.0 → 1.2.0).

Modified principles: N/A (no existing principle redefined)
Added sections:
  - Core Principles I–VI (1.0.0)
  - Core Principle VII — Test Coverage & Organization (1.1.0)
  - Core Principle VIII — Responsive, Multi-Device Layout (1.2.0)
  - Technology & Architecture Constraints
  - Development Workflow & Quality Gates (Test Gate added in 1.1.0)
  - Governance
Removed sections: None (all template placeholders resolved)

Templates requiring updates:
  - .specify/templates/plan-template.md ............ ✅ compatible (Constitution Check
    derives gates from this file at plan time; no static edits needed)
  - .specify/templates/spec-template.md ............ ✅ compatible (no constitution refs)
  - .specify/templates/tasks-template.md ........... ✅ compatible (no constitution refs)
  - .specify/templates/checklist-template.md ....... ✅ compatible (no constitution refs)

Follow-up TODOs: None. RATIFICATION_DATE set to original adoption (2026-06-08).
-->

# Ladybug Constitution

Ladybug is a meme-sharing site (similar to 9gag.com): users upload images, videos, and
YouTube links and browse an endless feed of entries. The frontend is React; the backend is
Laravel. This constitution defines the non-negotiable rules that govern how the project is
built and maintained.

## Core Principles

### I. Minimal Dependencies (NON-NEGOTIABLE)

Every dependency is a liability and MUST be justified. The default answer to "add a library"
is no.

- New runtime dependencies (npm or Composer) MUST NOT be introduced without explicit human
  approval requested before installation. Open the proposal with the problem, the candidate
  package, and why it cannot reasonably be written in-house.
- Prefer writing small, focused helpers over importing a package for a fraction of its
  surface. Do not pull in a monolithic framework for one function.
- The existing stack (Laravel, Sanctum, React, React Router) is the baseline. Reach for it
  before reaching outward.
- Every dependency that is added MUST be accompanied by a one-line rationale (why it exists,
  what it replaces).

Rationale: Low dependency count keeps the build auditable, secure, and long-lived; it is the
project owner's explicit standing instruction.

### II. Coding Conventions Adherence

`docs/CODING_CONVENTIONS.md` is binding for all code in this repository.

- JavaScript/TypeScript: 2-space indent, semicolons required, `camelCase` functions/vars,
  `PascalCase` components/classes, booleans prefixed `is`/`has`/`should`. Functions MUST stay
  under 50 lines; classes under 300.
- PHP: PSR-12, 4-space indent, `declare(strict_types=1)`, typed signatures, functions under
  30 lines.
- Single-line `if`/`for`/`while` bodies MUST use braces with the statement on its own line.
- Comments explain *why*, not *what*. No commented-out code, no debug output
  (`console.log`, `var_dump`) in committed code.

Rationale: A single shared style keeps a two-language codebase readable and reviewable; the
conventions file already encodes the agreed standard.

### III. Browser-Native Navigation & Deep Linking

The site MUST behave like a proper web application, not a stateful SPA that breaks the browser.

- Browser Back, Forward, and Refresh MUST always restore the correct view and scroll context.
- Every meaningful view has a real, shareable URL. The main feed is paginated; navigating
  between pages MUST update the URL so it is bookmarkable and refresh-safe.
- The feed loads 10 entries at a time as the user scrolls. After each 200 entries, infinite
  loading stops and an explicit "Load more" control advances to the next page.
- Each meme has its own page reachable directly by URL (see Principle V).

Rationale: Predictable navigation and shareable links are core to a content site; the owner
called these out as hard requirements.

### IV. Theme & Accessibility Respect

The UI MUST respect the user's environment.

- Light/dark appearance MUST follow the user's OS/browser preference
  (`prefers-color-scheme`) by default. If a manual override is offered, it MUST persist and
  override the system default without breaking refresh.
- Color MUST NOT be the sole means of conveying information.
- Images MUST have `alt` text; form inputs MUST have associated `<label>`s; interactive
  components MUST expose appropriate `role`/`aria-*` attributes.

Rationale: Respecting user preferences and accessibility is an explicit requirement and a
baseline of professional web work.

### V. Stable Meme Identifiers

Each meme is addressed by a stable, opaque public code.

- The public identifier MUST be exactly 10 characters drawn from `[A-Za-z0-9-_]`
  (YouTube-style; case-sensitive).
- This code, not a database auto-increment id, is what appears in URLs and is used to fetch a
  single meme's page.
- Codes are immutable once assigned and MUST be unique.

Rationale: Opaque fixed-length codes give clean shareable permalinks and avoid leaking
sequential counts or enabling trivial enumeration.

### VI. Security & Input Validation

All external input is untrusted.

- Uploaded content (images, videos, YouTube links) MUST be validated server-side for type,
  size, and well-formedness before persistence. YouTube links MUST be parsed/validated, not
  embedded blindly.
- Database access MUST use parameterized queries / the ORM; never string-concatenated SQL.
- Output MUST be escaped for its target context (HTML, URL, attribute) to prevent injection
  and XSS.
- Secrets live in environment variables only; never commit `.env` or credentials. Provide a
  `.env.example` with placeholders.

Rationale: A site accepting public uploads and embeds is a high-value injection target;
validation at the boundary is non-negotiable.

### VII. Test Coverage & Organization

The codebase MUST be backed by meaningful automated tests.

- Line/statement coverage MUST be **90% or higher**. A change that drops coverage below 90%
  MUST NOT be merged until tests are added to restore it.
- All tests live under a single top-level `tests/` directory (one per language stack as the
  toolchain requires — e.g., Laravel's `tests/`). Test files MUST mirror the real source
  structure: a test for `app/Services/MemeService.php` lives at
  `tests/.../Services/MemeServiceTest.php`, and likewise for frontend modules. The path under
  `tests/` mirrors the path of the code it covers.
- Tests MUST cover the happy path and the edge cases (invalid uploads, bad codes, pagination
  boundaries at the 200-entry break, theme fallback). Use descriptive test names.
- Code MUST be written to be testable: pure functions, dependency injection, and separation
  of concerns over hidden global state.

Rationale: A public upload site needs a safety net for validation and navigation logic;
mirroring the source tree keeps tests discoverable as the codebase grows.

### VIII. Responsive, Multi-Device Layout

The site MUST be usable across the full range of common viewport sizes.

- Layouts MUST adapt fluidly to mobile, tablet, and desktop widths. There MUST be no
  horizontal scrolling, clipped content, or overlapping elements at common breakpoints
  (roughly 320px through wide desktop).
- The document MUST declare a responsive viewport (`<meta name="viewport">`), and layouts MUST
  use relative/fluid units and CSS media queries (or equivalent) rather than fixed pixel
  widths that assume a single screen size.
- Content (feed, single-meme page, forms, menus) MUST reflow rather than overflow. Images and
  embeds — including YouTube players — MUST scale within their container while preserving
  aspect ratio.
- On touch/small screens, interactive controls MUST have adequate target size and spacing, and
  navigation plus the feed MUST remain fully operable by touch.

Rationale: A meme-sharing feed is consumed heavily on phones; a layout that works only on
desktop fails the majority of its audience.

## Technology & Architecture Constraints

- **Backend**: Laravel (PHP 8.1+) with Sanctum for authentication. Server-side image handling
  via the already-present image library; do not add a second one.
- **Database**: MySQL, accessed exclusively through Laravel's Eloquent ORM / query builder
  (parameterized — never raw string-concatenated SQL, per Principle VI). Schema changes go
  through Laravel migrations.
- **Frontend**: React 18 with React Router for client-side routing. Build via Vite.
- **API contract**: The React app talks to Laravel over a JSON API. Pagination is page-based
  and reflected in the URL; the page size for feed loads is 10, and the infinite-scroll batch
  cap before a "Load more" page break is 200.
- **Identifiers**: 10-char `[A-Za-z0-9-_]` codes per Principle V are the canonical public handle
  for memes.
- **Theming**: Driven by `prefers-color-scheme` with optional persisted override (Principle
  IV).
- **Responsive layout**: The frontend MUST be built mobile-first and adapt across mobile,
  tablet, and desktop viewports via fluid units and CSS media queries (Principle VIII); fixed
  single-width layouts are not acceptable.
- Any deviation from this stack, or any new package, falls under Principle I and requires
  prior approval.

## Development Workflow & Quality Gates

- **Plan first**: Features follow the Spec Kit flow (specify → plan → tasks → implement). The
  plan's Constitution Check MUST pass before implementation; unavoidable violations are
  recorded in the plan's Complexity Tracking with justification.
- **Convention gate**: Code MUST satisfy `docs/CODING_CONVENTIONS.md` and the pre-commit
  checklist therein (function/class size, naming, no debug output, no secrets) before merge.
- **Dependency gate**: A change that adds an npm or Composer dependency MUST surface that
  dependency and its rationale for explicit approval (Principle I) before it is merged.
- **Test gate**: Tests MUST pass and total coverage MUST stay at or above 90% (Principle VII)
  before merge. New code arrives with its mirrored tests under `tests/`.
- **Manual verification**: In addition to automated tests, changes affecting navigation,
  theming, layout, upload, or the meme page MUST be manually verified against the
  Back/Forward/Refresh, light/dark, and responsive (mobile/tablet/desktop) requirements before
  being called done.

## Governance

This constitution supersedes other practices where they conflict. When a referenced document
(e.g., `docs/CODING_CONVENTIONS.md`) and this constitution disagree, this constitution wins.

- **Amendments**: Changes to this constitution MUST be made via a documented edit that states
  what changed and why, and MUST re-run the consistency check against the Spec Kit templates.
- **Versioning**: Semantic versioning applies. MAJOR for backward-incompatible governance or
  principle removals/redefinitions; MINOR for a new principle/section or materially expanded
  guidance; PATCH for clarifications and wording fixes.
- **Compliance review**: Every plan and code review MUST verify compliance with these
  principles. Complexity or dependency additions MUST be justified, not assumed.
- **Runtime guidance**: Day-to-day coding style is governed by `docs/CODING_CONVENTIONS.md`;
  this constitution governs the non-negotiable boundaries above it.

**Version**: 1.2.0 | **Ratified**: 2026-06-08 | **Last Amended**: 2026-06-09
