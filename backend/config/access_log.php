<?php

declare(strict_types=1);

return [

    // Defaults to true so a fresh deployment records without anyone remembering to enable it
    // (FR-020). env() already casts the strings "false"/"0", so ACCESS_LOG_ENABLED=false does
    // what it looks like it does. Off means "write nothing", never "erase" (FR-021).
    'enabled' => env('ACCESS_LOG_ENABLED', true),

    // Matched with $request->is(), so Laravel's '*' wildcards work and patterns carry no leading
    // slash. The two defaults are the liveness probes this deployment polls continuously —
    // api/health (deploy.sh, restore.sh and CI) and Laravel's own 'up' route — which would
    // otherwise outnumber real traffic in the history by orders of magnitude (FR-022).
    // Authentication endpoints are deliberately NOT excluded: they are recorded *and* redacted.
    // 'strlen' rather than a bare array_filter so a pattern of "0" survives the empty-entry drop.
    'excluded_paths' => array_values(array_filter(
        array_map('trim', explode(',', (string) env('ACCESS_LOG_EXCLUDED_PATHS', 'api/health,up'))),
        'strlen'
    )),

    // max(1, ...) guards the same way config/remember.php guards REMEMBER_ME_LIFETIME: a
    // misconfigured or non-numeric value casting to 0 would make the cutoff now() and delete the
    // whole history the window was meant to bound (FR-023).
    'retention_days' => max(1, (int) env('ACCESS_LOG_RETENTION_DAYS', 30)),

    // Bytes, applied per value — each query parameter, each form field, each cookie and the raw
    // body are capped independently, so worst-case entry size is value count x limit, not the
    // limit (FR-018, FR-018b). Raising it needs no migration: body is longtext and the parameter
    // columns are JSON.
    'value_limit' => (int) env('ACCESS_LOG_VALUE_LIMIT', 65536),

    // The application drives its own daily prune so an unattended deployment stays bounded
    // without host-level scheduling (FR-027a). 03:00 keeps the delete off the docs/DEPLOYMENT.md
    // backup window on a 1 vCPU box.
    'prune_enabled' => env('ACCESS_LOG_PRUNE_ENABLED', true),
    'prune_cron' => env('ACCESS_LOG_PRUNE_CRON', '0 3 * * *'),

    // The single name-based sensitive list (FR-015): one list, applied identically to query,
    // input and cookies at every nesting depth, so a rule cannot be enforced in one place and
    // forgotten in another. Matching is on the NAME a value was submitted under, never on what
    // the value looks like — content sniffing would both miss a weak password and shred a
    // legitimate high-entropy meme hash. Matching is case-insensitive; the matched value is
    // replaced with `[redacted]` rather than removed (FR-014), and everything not listed here
    // is recorded in full (FR-016). Full rationale: contracts/redaction.md.
    'sensitive' => [
        'password',                 // 007 registration/login, 022 reset
        'password_confirmation',    // 007 registration, 022 reset
        'current_password',         // 022 account-page password change
        'new_password',             // defensive: a plausible field name for the same secret
        // Load-bearing today, not defensive: 022's reset token rides the LINK's fragment but is
        // SUBMITTED as a form field by ResetPasswordRequest and CheckResetTokenRequest, so a
        // live one-time credential is in the body of every reset and every link-validity probe.
        'token',
        '_token',                   // Laravel's CSRF field
        'remember_token',           // the users column 022 rotates on every password change
        'api_token',                // bearer credentials (FR-013 "authorization credential")
        'access_token',
        'refresh_token',
        'id_token',
        'secret',
        'client_secret',            // Google OAuth client secret (017)
        'authorization',            // the header name as a field/cookie namesake
        'signature',                // 008's signed verification links sign in the QUERY STRING
        'code',                     // Google OAuth authorisation code (017) — exchangeable for a session
        'state',                    // Google OAuth CSRF state (017)
        'credential',               // Google One Tap's credential (a signed ID token)
    ],

    // Matched with str_starts_with instead of an exact name, for the names that carry a
    // per-deployment suffix. Laravel's own recaller cookie is remember_web_<sha1 of the guard
    // name>, which cannot be listed exactly. The three OTHER per-deployment names — the session
    // cookie, XSRF-TOKEN and 018's remember cookie — are resolved from their own config at call
    // time by AccessLogRedactor, since config/remember.php derives its name from APP_NAME and a
    // literal here would silently stop matching on a deployment that renamed the app.
    'sensitive_prefixes' => ['remember_web_'],

];
