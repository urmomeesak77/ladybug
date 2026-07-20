# Quickstart: User Rating & Auto-Activation

Runnable validation for this feature. Details live in [`data-model.md`](./data-model.md) and
[`contracts/rating-api.md`](./contracts/rating-api.md); this file is the run guide.

## Prerequisites

- Docker Desktop running (there is **no local PHP** — backend commands go through a container,
  per CLAUDE.md).
- Stack up: `docker compose up -d`
- Migrations applied: `docker compose exec backend php artisan migrate`

## Automated gates

These are the same gates CI runs. All four must pass.

```powershell
# Backend — lint, then tests with coverage (sqlite :memory:, never the real DB)
docker compose exec backend vendor/bin/pint --test
docker compose exec backend php artisan test
docker compose exec backend php artisan test --coverage-clover=coverage.xml
python .github/scripts/check_coverage.py coverage.xml   # ≥90% gate

# Frontend — lint, then tests with coverage over ALL of src/
docker compose exec frontend npm run lint
docker compose exec frontend npm run test -- --coverage
```

Backend PHP edits need `docker compose restart backend` to take effect (opcache
`validate_timestamps=0`). After a merge or branch switch, `docker compose restart frontend` if
Vite serves stale UI.

## Scenario 1 — The rating tracks moderation (US1)

Seed an account and a meme, then drive the moderation endpoints as an admin.

1. Register a member; confirm its rating starts at **0** (query the DB directly — the rating is
   deliberately absent from every API response, FR-022).
2. Activate one of its memes → rating **1**.
3. Deactivate it → rating **0** (credit released, FR-005).
4. Activate again, then soft-delete → rating **0** (holds credit while trashed, loses the −1).
5. Restore → rating **1** (penalty returned, FR-010).
6. Purge → rating **−1** (credit released + penalty applied = −2 from 1, FR-009).

**Expected**: each step lands exactly on the stated number. Reading the rating requires a DB
query or the admin table (scenario 4) — there is no user-facing rating endpoint.

```powershell
docker compose exec backend php artisan tinker --execute="echo App\Models\User::where('name','tester')->value('rating');"
```

## Scenario 2 — Path independence (SC-004)

Run these three sequences on three separate memes owned by the same fresh account:

- activate → purge
- activate → deactivate → purge
- activate → soft delete → purge

**Expected**: rating **−3** total, i.e. exactly −1 per meme. If any sequence yields a different
number, FR-009 or FR-008 is broken. The full sequence table is in
[`data-model.md`](./data-model.md#worked-sequences-sc-004-destination-never-route).

## Scenario 3 — Auto-activation on upload (US2, US3)

Upload through the real UI at `/upload` (or `POST /api/posts`) as three accounts:

| Account | Setup | Expected |
|---------|-------|----------|
| member, rating 14 | set rating to 14 in DB | upload is **pending** — absent from the feed, `/posts/{hash}` 404s |
| member, rating 15 | set rating to 15 | upload is **live immediately** in the feed; rating becomes 16 |
| admin, rating −5 | set rating to −5 | upload is **live immediately**; rating becomes −4 |

Then activate the pending meme from the admin table → it appears in the feed and its owner's
rating rises by 1 (US2 §3).

**Also verify (security, research D4)**: for the pending upload, copy its image URL from the
DB-derived public path and request it directly. It **must 404** — a pending meme's bytes must
not be fetchable on the public disk. This is the one check most likely to be missed, because
the JSON already hides the row.

## Scenario 4 — The rating column in the moderation table (US1, FR-021)

Sign in as an admin, open `/admin/posts`.

**Expected**:
- Every row shows its uploader's current rating.
- A meme with no owning account shows an explicit **"no account"** — not `0`, not a blank cell.
- Acting on a row updates that row's rating in place without leaving the page.
- Two rows owned by the same account always show the same number.

## Scenario 5 — Edge cases

| Case | Expected |
|------|----------|
| Activate/delete a meme with `user_id = null` | Action succeeds normally; no rating moves; no error (FR-012). |
| Activate the same meme twice | Rating moves **+1 total**, not +2 (FR-014). |
| Two simultaneous activates on one meme | Rating moves **+1 total** (FR-014 under real concurrency). |
| Rating at 32767, activate another meme | Rating stays 32767; the activate still returns 200 (FR-011a). |
| Deactivate a meme activated *before* this feature | Rating drops by 1 despite no matching +1 — accepted (FR-002, SC-005). |

## Manual verification gate (Constitution)

The moderation table gains a column, so the responsive and theming checks apply:

- **Responsive** (Principle VIII): the table reflows at ~320px, tablet, and desktop with no
  horizontal page scroll. The extra column is the risk — the table must scroll inside its own
  container, not push the page wide.
- **Theming** (Principle IV): light and dark both legible, including the "no account" text.
- **A11y** (Principle IV): the rating cell is not conveyed by colour alone; the "no account"
  state is text.
- **Navigation** (Principle III): Back/Forward/Refresh on `/admin/posts?page=N` restores the
  page.

## Done when

- [ ] All four automated gates pass, coverage ≥90% on both stacks.
- [ ] Scenarios 1–5 produce the stated numbers exactly.
- [ ] Pending upload media 404s on the public disk.
- [ ] Manual responsive/theme/a11y/navigation checks pass.
