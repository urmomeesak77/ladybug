# Contract: Health endpoint

The single external interface this feature exposes. It exists so CI's backend feature test has a
real route to exercise (booting the framework for coverage) and so the dev environment has a
trivial liveness check.

## `GET /api/health`

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/api/health` |
| Auth | None (public) |
| Request body | None |
| Success status | `200 OK` |
| Response content type | `application/json` |

### Response body (200)

```json
{
  "status": "ok"
}
```

### Acceptance (drives `tests/Feature/Http/HealthTest.php`)

1. **Given** the application is booted, **When** a client sends `GET /api/health`, **Then** the
   response status is `200` and the JSON body is exactly `{ "status": "ok" }`.
2. The route is registered under the `/api` prefix via `bootstrap/app.php` routing config (no
   `install:api`, no Sanctum middleware).

### Notes

- This endpoint is intentionally minimal and has no dependencies on the database, so the feature
  test passes even before any migrations exist. (A future `/api/health` enhancement could add a
  DB-connectivity check; out of scope here.)
- No other endpoints are defined by this feature.
