# Data Model: Queued Background Work (024)

## trashposts (changed)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `media_state` | string(16) | no | `'ready'` | `processing` \| `ready` \| `failed`. Existing rows become `ready` via the default — no backfill. Not in `$fillable`. |
| `media_source` | string(255) | yes | null | Relative path on the private `local` disk of the staged upload while `processing`; cleared on `ready`/`failed`. Never serialized. Not in `$fillable`. |

Migration: `2026_10_14_000000_add_media_state_to_trashposts_table.php` (add both columns; down drops them).

### State transitions

```
            (image/video upload)                (YouTube upload)
                    │                                   │
                    ▼                                   ▼
             ┌─────────────┐  job succeeds       ┌───────────┐
             │ processing  │────────────────────▶│   ready   │
             └─────────────┘                     └───────────┘
                    │ job fails / killed twice
                    ▼
             ┌─────────────┐
             │   failed    │ (terminal; delete/purge only)
             └─────────────┘
```

- `processing → ready`: one transaction with the row locked; also sets `activated_at` and credits
  the uploader iff the job's `autoActivate` is true and the row is not trashed.
- `processing → failed`: files for the hash removed; never activated, never credited.
- Moderator `activate` requires `ready` (409 otherwise). `deactivate`, `delete`, `restore`, `purge`
  are unchanged and allowed in every state; `purge` of a `processing` post also deletes its staged
  source.

### Visibility (single definition)

`Trashpost::scopePubliclyVisible` = `activated_at IS NOT NULL AND media_state = 'ready'` (+ the
SoftDeletes scope). `TrashpostService::findViewableByHash`'s public branch uses the same predicate;
owner/admin branches are unchanged, so the uploader can open their own *processing*/*failed* post.

## jobs / failed_jobs (existing, unchanged)

Durable queue rows and permanently failed jobs with exception text. Operator commands:
`queue:failed`, `queue:retry {id|all}`, `queue:forget {id}`.

## Job payloads

| Job | Payload | tries | backoff | timeout |
|---|---|---|---|---|
| `ProcessPostMedia` | post hash, `autoActivate` bool | 2 | — | 180 s |
| `FetchYoutubeThumbnail` | post hash | 3 | 30, 120 s | 30 s |
| `SendRecoveryLink` | submitted e-mail address | 3 | 10, 60 s | 30 s |
| `QueuedVerifyEmail` (notification) | user (serialized model) | 5 | 10, 60, 300, 900 s | 30 s |
| `QueuedResetPassword` (notification) | user, token | 5 | 10, 60, 300, 900 s | 30 s |

Payloads carry public hashes / the model reference — never file bytes.
