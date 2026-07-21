# Ladybug Backend

Laravel 12 (PHP 8.2+) JSON API with Sanctum cookie-session auth, backed by MySQL via
Eloquent. It serves the read feed, uploads, auth + e-mail verification, roles, and the
admin moderation console. The API surface is listed in the [root README](../README.md).

**There is no local PHP** — run everything through Docker (project convention). All four
commands run from the **repo root**:

```powershell
docker compose exec backend vendor/bin/pint --test               # lint (PSR-12, pint.json)
docker compose exec backend php artisan test                     # PHPUnit
docker compose exec backend php artisan test --coverage-clover=coverage.clover
python .github\scripts\check_coverage.py backend\coverage.clover 90
```

Tests run on **sqlite `:memory:` only** — `Tests\TestCase` hard-aborts otherwise, so a
test run can never touch the dev database. Note that `lockForUpdate()` is a no-op there:
concurrency guarantees are verified by hand against MySQL, per each feature's quickstart.

PHP edits need `docker compose restart backend` to take effect — the dev image runs
opcache with `validate_timestamps=0` (it fixes a ~2s/request bind-mount penalty).

## Structure

```
app/
  Http/Controllers/   TrashpostsApiController, AuthController,
                      EmailVerificationController, Admin/ModerationController
  Http/Requests/      form requests (validation)
  Http/Resources/     TrashpostResource, AdminTrashpostResource, UserResource
  Models/             Trashpost, User
  Enums/              Role — guest < member < admin < superuser
  Services/           TrashpostService, TrashpostImageProcessor/Service,
                      YoutubeThumbnailService, ModerationService,
                      MediaOwnershipService, RatingService, UserService
  Support/            MediaPath, ImageFile, GifFile
  Utils/              Str (createUniqueHash), Base64, Json, Youtube
  Console/Commands/   media:seed, make:superuser
database/migrations/  schema
tests/                PHPUnit — Unit/ + Feature/, mirroring app/ (Principle VII)
```

A meme's public identifier is the immutable 10-char `hash` column minted by
`App\Utils\Str::createUniqueHash` — database ids are never exposed in URLs or payloads.

## Media storage layout

All Ladybug media lives on the Laravel `public` disk under
`storage/app/public/`. This is the single canonical destination for the seeded
prototype library **and** every future image/video upload — no other location is
used. The authoritative contract is
[`specs/003-media-storage/contracts/media-layout.md`](../specs/003-media-storage/contracts/media-layout.md);
the rules below are a summary.

| Media type | Path (relative to the `public` disk) |
|------------|--------------------------------------|
| Image | `image/trash/{size}/{shard}/{code}.{ext}` |
| Video | `video/trash/{shard}/{code}.{ext}` (no size variants) |

- **`{size}`** ∈ `original, 800, 500, 300, 100` (images only; not every image has
  every variant — missing variants are never fabricated). Videos are not resized.
- **`{shard}`** = the lowercased first character of the filename, or `other` when
  that character is not `[a-z0-9]`. Keeps any one directory from holding the whole
  library. Images and videos shard identically.
- **`{ext}`** allowlist for images: `jpg, jpeg, png, gif` (case-insensitive). Any
  other file (notably `.gitignore`) is **not** media and is never copied or served.
- Path/shard/extension logic is implemented once in
  [`app/Support/MediaPath.php`](app/Support/MediaPath.php) and shared by the seed
  command and the upload feature.

### Media visibility

A meme's image variants and YouTube thumbnail stay on the `public` disk in every state —
pending a moderator, deactivated, or soft-deleted included (design 2026-07-21). Hidden
memes are filtered out at the query level by the public API, not by moving bytes, so an
admin can still see a hidden meme's media in the moderation console.

### Seeding the existing library

```bash
php artisan media:seed --source="C:\projects\trash\storage\app\public\image\trash"
```

Copies the Trashpost prototype's images into the layout above, idempotently, and
prints a verification report (per-size source-vs-dest counts, checksum mismatches,
stray files). The source path defaults to `MEDIA_SEED_SOURCE` in `.env`
(see `.env.example`). Add `--dry-run` to report without writing.

### Version control

The media payload is **user content, not source code**, and is excluded from git
by `storage/app/public/.gitignore` (`*` + `!.gitignore`). No media file under
`image/trash/` or `video/trash/` is ever staged or committed; only the layout
contract, the ignore rule, and the code/tests are.

## Framework

Built on [Laravel](https://laravel.com) — see the [Laravel documentation](https://laravel.com/docs)
for framework concepts (routing, Eloquent, migrations, queues). Project-specific rules
that override framework defaults live in [`docs/CODING_CONVENTIONS.md`](../docs/CODING_CONVENTIONS.md)
and the binding [constitution](../.specify/memory/constitution.md).
