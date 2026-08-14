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

    // The single name-based sensitive list (FR-015) — filled from
    // specs/023-access-log/contracts/redaction.md when the redaction pass lands.
    'sensitive' => [],
    'sensitive_prefixes' => [],

];
