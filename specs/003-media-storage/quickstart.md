# Quickstart: Media Storage Seed

Validation guide for the `media:seed` feature. Proves the prototype images land in the
canonical layout, the report confirms integrity, the run is idempotent, and no media is
committed. See [contracts/](./contracts/) for the authoritative path and CLI rules.

## Prerequisites

- `backend/` Laravel app installed (`composer install` already run for feature 002).
- Read access to the prototype media tree at
  `C:\projects\trash\storage\app\public\image\trash`.
- Run commands from `backend/`.

## 1. Run the automated tests (no large copy)

```powershell
php artisan test --filter "MediaPath|SeedMedia"
```

Expected: `MediaPathTest` (shard rules, sizes, image/video paths, extension allowlist) and
`SeedMediaCommandTest` (copy structure, non-media skipped, idempotency, report + exit code)
all pass. These use `Storage::fake('public')` + temp fixtures, not the 1.3 GB payload.

## 2. Dry-run the real seed

```powershell
php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash" --dry-run
```

Expected: report prints per-size source counts, lists `stray skipped (source): 5` (the
prototype's `.gitignore` files), and `RESULT: OK` — without writing any files.

## 3. Run the real seed

```powershell
php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash"
```

Expected: files copied into `backend/storage/app/public/image/trash/{size}/{shard}/…`;
report shows every size `match = OK`, `checksum mismatches: 0`, `stray files in
destination: 0`, `RESULT: OK`; exit code `0`.

## 4. Spot-check the layout

```powershell
# A known code resolves under each size that exists for it:
Get-ChildItem backend\storage\app\public\image\trash\original\1\ | Select-Object -First 3
Test-Path backend\storage\app\public\image\trash\300\1\1dcmpenbnr.jpg
```

Expected: files present under the `{size}/{shard}/{code}.{ext}` structure; the `other`
shard exists wherever the source had non-alphanumeric-leading filenames.

## 5. Confirm idempotency

```powershell
php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash"
```

Expected: `copied: 0`, all `skipped`, `RESULT: OK`, exit `0` — no duplicates or
corruption.

## 6. Confirm media is NOT tracked by git

```powershell
git status --short backend/storage/app/public
git check-ignore backend/storage/app/public/image/trash/original/1
```

Expected: `git status` shows **no** media files staged or untracked-and-trackable;
`git check-ignore` echoes the path (proving it is ignored by
`backend/storage/app/public/.gitignore`).

## Success criteria mapping

| Step | Spec criteria |
|------|---------------|
| 1 | FR-002/004/006/007, SC-007 (logic under test) |
| 2–3 | FR-003/004/005/011, SC-001/002/007 |
| 4 | FR-001/002, SC-001 |
| 5 | FR-007, SC-004 |
| 6 | FR-010, SC-006 |
