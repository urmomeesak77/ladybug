# Quickstart: Trashpost Comments — Validation Guide

Runnable checks that prove the feature works end-to-end. Backend runs through the
`php:8.3-cli` Docker container (no local PHP — project convention); the dev stack runs via
Docker Compose. See [contracts/](./contracts/) and [data-model.md](./data-model.md) for the
authoritative shapes.

## Prerequisites

- Dev stack up (`docker compose up -d`), frontend on its Vite port, backend on the API port.
- One activated (public) trashpost — note its `{hash}` from the feed or `/api/posts`.
- Three accounts: a **verified member**, an **unverified member**, and an **admin**.
- After editing backend PHP, `docker compose restart backend` (opcache `validate_timestamps=0`).

## Backend: migrate

```bash
docker compose exec backend php artisan migrate
```

Confirms the `comments` table is created with the `hash` unique index, the
`trashpost_id` cascade FK, and the nullable `user_id` FK.

## Backend: automated tests + coverage

```bash
# from backend/ via the php container (mirrors CI; sqlite :memory:)
docker run --rm -v "${PWD}:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit --filter 'Comment'
# full suite + coverage gate (≥90%, Clover) as CI runs it
docker run --rm -v "${PWD}:/app" -w /app php:8.3-cli vendor/bin/phpunit --coverage-clover coverage.xml
```

Expected: `CommentServiceTest`, `CommentControllerTest`,
`CommentModerationControllerTest` green; overall line coverage ≥ 90%.

## Frontend: automated tests

```bash
# from frontend/
npm run lint
npm run test           # Vitest — commentModel / commentApi / useComments / components
```

## Manual scenarios (map to acceptance criteria)

### US1 — Read comments (guest + signed-in)

1. Open `/posts/{hash}` on a post with several comments as a signed-out visitor.
   - Comments listed **newest-first**; each shows author name, text, and post time
     (FR-002, FR-003). The comment **count** is shown (US1 scenario 4).
2. Open a post with **no** comments → explicit "no comments yet" state, not a blank gap
   (FR-016).
3. Scroll to the initial batch of 10 → a "load more older comments" control appears; click
   it → the next 10 older comments append (FR-019). The page URL does **not** change.

### US2 — Add a comment (verified / unverified / guest)

4. Signed in as the **verified member**, type a comment and submit.
   - It appears at the **top** of the list attributed to you, **no full reload**, scroll
     position preserved; count increments (FR-006, SC-001).
5. Sign out, reload → the form is replaced by a **sign-in prompt**; no form (FR-005).
6. Sign in as the **unverified member** → the form is replaced by a **verify-your-e-mail
   prompt** (FR-005).
7. Bypass the UI: `POST /api/posts/{hash}/comments` as a guest → **401**; as unverified →
   **403**; no comment created (FR-004, SC-002).
8. Submit an empty/whitespace-only body → **422** validation message, nothing saved
   (FR-007). Submit > 1000 chars → **422**, nothing saved (FR-008).
9. Submit a body containing `<script>alert(1)</script>` → stored verbatim and rendered as
   **literal text** on reload, never executed (FR-009, SC-007).
10. `POST` to an unknown post hash → **404**, no comment created (FR-017).

### US3 — Hide / unhide (admin)

11. As **admin**, open a post and hide a comment via the per-comment kebab.
    - Reload as a guest → the comment is **gone** from the public list and the public count
      dropped by one (FR-011, FR-015, SC-005).
    - As admin, the comment is still shown, **marked hidden** (badge/text, not color alone),
      with an **Unhide** option (FR-011).
12. As a **member**, open the post → **no** hide/unhide/delete control on any comment
    (FR-010, US3 scenario 4).
13. As admin, unhide it → visible to everyone again; count restored (FR-012).

### US4 — Permanent delete (admin)

14. As admin, choose Delete on a comment → a **confirmation** is required (FR-013, US4
    scenario 1). Cancel → comment unchanged (US4 scenario 3).
15. Confirm delete → the comment disappears for **everyone including admins** and cannot be
    recovered; count updates; admin keeps their place (FR-013, FR-014, SC-006).
16. Hide a comment, then delete it → deletion succeeds and supersedes the hidden state
    (edge case "Hide then delete").

### Lifecycle & responsive/theming

17. Soft-delete or deactivate the parent trashpost (admin console) → its `/posts/{hash}` is
    no longer publicly viewable, so the comment section is unreachable publicly, but the
    comments are **retained** (verify via admin view / DB) (FR-020, edge case).
18. **Purge** the parent trashpost → its comments are **cascade-deleted**; no orphaned
    comments remain (`SELECT * FROM comments WHERE trashpost_id = …` is empty) (FR-020).
19. Hard-delete a comment author's account (013) → their comments **remain** and show the
    snapshot `username` fallback rather than breaking the list (edge case "Author account
    later removed").
20. Toggle OS light/dark and resize from ~320px to wide desktop → the comment list, form,
    prompts, and controls reflow with **no horizontal scroll or clipped controls**, in both
    themes (FR-018, SC-008, Principles IV & VIII).

## e2e (Playwright)

A `comments` spec on the isolated `docker-compose.e2e.yml` stack covers the core slice:
read newest-first, post as a verified user (appears on top, no reload), guest/unverified see
the prompt, admin hide removes it from a guest view, admin delete removes it for all.
