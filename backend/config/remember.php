<?php

declare(strict_types=1);

use Illuminate\Support\Str;

return [
    // max(1, ...) guards against a misconfigured REMEMBER_ME_LIFETIME (non-numeric or empty)
    // casting to 0, which would set session.lifetime = 0 and instantly expire every
    // remembered session — strictly worse than the feature not existing.
    'lifetime' => max(1, (int) env('REMEMBER_ME_LIFETIME', 60 * 24 * 7)), // minutes; 7 days
    'cookie' => env('REMEMBER_ME_COOKIE', Str::slug((string) env('APP_NAME', 'laravel')).'-remember'),

    // Odds (per request) that SessionGarbageCollector::sweepIfLucky() runs. Same shape and
    // default as the now-disabled config('session.lottery') it replaces (see session.php) —
    // only the deletion threshold differs (always 'lifetime' above, never the ambient
    // per-request session.lifetime).
    'gc_lottery' => [2, 100],
];
