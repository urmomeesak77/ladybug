# Contract: `php artisan media:seed`

One-time (idempotent) Artisan command that copies the prototype's image library into the
canonical media layout and reports the result. Implemented by
`App\Console\Commands\SeedMediaCommand`.

## Signature

```
php artisan media:seed [--source=PATH] [--dry-run]
```

| Option | Required | Default | Meaning |
|--------|----------|---------|---------|
| `--source=PATH` | no | `env('MEDIA_SEED_SOURCE')`, else the documented prototype path | Absolute path to the prototype media root (`…/image/trash`) to copy from |
| `--dry-run` | no | off | Scan and report what would be copied/excluded without writing files |

## Behavior

1. **Resolve source**: from `--source`, else `MEDIA_SEED_SOURCE`, else default prototype
   path. If the source directory does not exist → error message, exit `1`.
2. **Enumerate** all files under the source recursively.
3. **Classify** each file via `MediaPath::isMediaFile`:
   - Non-media (e.g., `.gitignore`) → counted as `straySkipped`, never copied.
   - Media → mapped to its destination `image/trash/{size}/{shard}/{file}` derived from
     its source size dir and `MediaPath::shardFor`.
4. **Copy (idempotent)**: write to the `public` disk only when the destination is missing
   or its byte size differs from the source; otherwise count as `skipped`. (Skipped under
   `--dry-run`.)
5. **Verify**: for every expected destination file, compare source vs destination size and
   content hash; tally `checksumMismatches`. Scan the destination tree for any non-media
   file; tally `strayInDest`.
6. **Report**: print the verification report (see below).
7. **Exit code**: `0` only if every per-size count matches **and**
   `checksumMismatches == 0` **and** `strayInDest == 0`; otherwise nonzero.

## Output (verification report)

Human-readable table written to stdout, e.g.:

```
Media seed report (source: .../image/trash)
size       source  dest   match
original     2620   2620   OK
800           111    111   OK
500           997    997   OK
300          2358   2358   OK
100          2618   2618   OK
copied: 8704   skipped: 0   stray skipped (source): 5
checksum mismatches: 0
stray files in destination: 0
RESULT: OK
```

(Counts are illustrative; exact values are computed at run time. Source media counts
exclude the per-size-dir `.gitignore` files.)

## Guarantees / invariants

- **No mutation of the source** — files are copied, never moved or deleted (FR-003).
- **Byte-for-byte** destination files (FR-005); failures surface as `checksumMismatches`.
- **Idempotent** — a second run copies nothing and still reports `OK` (FR-007, SC-004).
- **No stray files** copied or left in the destination (FR-006, SC-003).
- **No new dependencies**, no resizing, no DB or network access (Principles I, VI).

## Error modes

| Condition | Behavior |
|-----------|----------|
| Source path missing/unreadable | Error message, exit `1`, nothing written |
| A destination directory cannot be created / file cannot be written | Report the failing path, exit nonzero |
| Hash mismatch on any file | Listed in report, `checksumMismatches > 0`, exit nonzero |
