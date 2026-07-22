# Quickstart / Validation: Upload Page Polish

Run/validate the four changes end-to-end. Backend runs in Docker (no local PHP). See
[plan.md](./plan.md), [contracts/upload.md](./contracts/upload.md), and
[data-model.md](./data-model.md) for detail.

## Prerequisites

- Dev stack up (`docker compose up -d`), or the isolated e2e stack via `scripts\e2e.ps1`.
- **Rebuild the php image after the Dockerfile change** (adds `imagemagick` + GD `--with-webp`):
  `docker compose build backend && docker compose up -d backend`.
- A verified member account (register → verify via MailLog) to reach `/upload`.

## Automated checks (the real gates)

Backend (Docker, sqlite `:memory:`, ≥90% coverage):

```powershell
docker compose exec backend php artisan test --coverage
```

Frontend (Vitest ≥90% over all of `src/`, then ESLint + Pint):

```powershell
cd frontend; npm run lint; npm run test -- --coverage
docker compose exec backend ./vendor/bin/pint --test
```

E2E (isolated stack — must have imagemagick + libwebp in the e2e image):

```powershell
scripts\e2e.ps1   # runs frontend/tests/e2e/upload.spec.ts
```

Expected: all green; coverage ≥90% both stacks; new `WebpFile`, `MediaTabs`, `useTabsKeyboard`
covered.

## Manual validation scenarios

### US1 — Polished form + required title

1. Open `/upload` (verified member). **Heading reads exactly "Upload".** Form matches the
   login/register look (centered column, hairline heading, placeholder fields, full-width
   button).
2. Leave the title empty, pick an image, submit ⇒ **field-level "title required" message, no
   post created**. A spaces-only title behaves identically.
3. Fill a title + valid image, submit ⇒ redirected to `/posts/{hash}` with the meme rendered
   (same as before).
4. Check at 320px width and desktop, in light and dark ⇒ readable, no horizontal scroll.

### US2 — Image/YouTube tabs

5. Two tabs "Image" (selected) / "YouTube"; only the Image file input shows. Click "YouTube" ⇒
   only the link field shows. Selected state is visible **without relying on color** (underline/
   weight) and via screen-reader `aria-selected`.
6. Keyboard only: Tab into the tablist, Left/Right switch tabs, Home/End jump; the active
   panel's input is reachable. Enter a value, switch tabs, submit ⇒ **only the active tab's
   value is sent**; the departed tab's stale error is gone.

### US3 — WebP

7. On the Image tab the file picker offers/accepts `.webp`. Upload a valid **static** WebP +
   title ⇒ created, appears in the feed and on its permalink like any image.
8. Upload a valid **animated** WebP + title ⇒ created and **still animates in every size
   variant** (inspect the generated variants under `ladybug-storage`; frame count > 1). Verify
   it animates in the feed (which serves a downscaled variant), not just the original.
9. Upload a malformed/oversized "webp" ⇒ rejected with a clear message (same as other formats).

## Regression (SC-006)

10. JPEG, PNG, animated GIF, and YouTube-link posts still succeed unchanged (aside from the now
    -required title).
