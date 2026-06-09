# Quickstart: Read-Side Feed API

Validate that `GET /api/posts` and `GET /api/posts/{hash}` return visible posts with
correct pagination and existing-only image URLs. Backend-only feature. See
[contracts/feed-api.md](./contracts/feed-api.md) for the full contract and
[data-model.md](./data-model.md) for the response shape.

## Prerequisites

- Backend deps installed (`backend/`). No local PHP? Run everything through the
  `php:8.3-cli` Docker container (project convention) — mount `backend/` and run the
  composer/artisan commands inside it.
- No new dependencies are required for this feature.

## Automated tests (primary validation)

Run from `backend/`:

```bash
php artisan test
# coverage gate (CI parity): generates Clover, then enforces ≥90%
php artisan test --coverage-clover=coverage.xml
python ../.github/scripts/check_coverage.py coverage.xml
```

Expected: all suites green; total line coverage ≥ 90%.

The new tests (write these first — TDD):

- `tests/Unit/Services/TrashpostServiceTest.php`
  - newest-first ordering (`activated_at DESC, id DESC`);
  - default page size 10; `limit` clamped to `[1, 50]`; invalid `limit` ⇒ 10;
  - `start` cursor returns only strictly-older posts; unknown `start` ⇒ ignored;
  - non-activated and soft-deleted posts excluded; `findVisibleByHash` returns null
    for hidden/deleted/unknown.
- `tests/Unit/Services/TrashpostImageServiceTest.php` (uses `Storage::fake('public')`)
  - lists only sizes whose files exist; omits absent sizes;
  - `original`/`default` resolve per the rules; widest-first ordering;
  - null `file` ⇒ empty image data, no error.
- `tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (`RefreshDatabase`)
  - `GET /api/posts` returns ≤ 10 visible posts, newest-first, correct JSON shape;
  - cursor paging via `start` walks pages with no overlap/gap;
  - `GET /api/posts/{hash}` returns the post; unknown/hidden/deleted ⇒ 404.

Use `Database\Factories\TrashpostFactory` states (visible / hidden / soft-deleted /
link-only) to set up each scenario.

## Manual smoke (optional, with seeded media)

Serve the API and exercise it against real seeded data:

```bash
php artisan serve   # http://127.0.0.1:8000

curl -s "http://127.0.0.1:8000/api/posts" | jq '.data | length'         # 10
curl -s "http://127.0.0.1:8000/api/posts?limit=3" | jq '.data | length' # 3
# take the last hash from the first page and page backward:
curl -s "http://127.0.0.1:8000/api/posts?start=<hash>&limit=3" | jq '.data[].hash'
curl -s "http://127.0.0.1:8000/api/posts/<known-hash>" | jq '.data.hash, .data.sizes'
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8000/api/posts/nope"  # 404
```

Expected: pages do not overlap; each post's `sizes` URLs point only at files that
exist on disk; the default page returns 10; unknown hash ⇒ 404.

## Done when

- All three new test files pass; coverage ≥ 90%.
- `vendor/bin/pint --test` reports no style violations.
- Manual smoke (if run) matches the expectations above.
