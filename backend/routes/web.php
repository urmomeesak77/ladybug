<?php

declare(strict_types=1);

use App\Http\Controllers\ShellController;
use Illuminate\Support\Facades\Route;

// Every address that is not a real file reaches the SPA shell, which Laravel
// composes a <head> and a status code for. This replaces the stub that answered
// the root with a 404 purely to hide the stock welcome view.
//
// The `api|up|sanctum|storage` exclusion exists for the TEST process, not for
// production: nginx never routes those here, but PHPUnit calls the application
// directly with no nginx in front, and an unguarded catch-all would shadow the
// JSON API, the health probe and Sanctum in every feature test.
//
// The `(/|$)` is load-bearing — it makes the exclusion match a whole path
// SEGMENT. A bare `(?!api|up|sanctum|storage)` is a prefix test, and it would
// drop `/uptime`, `/apixyz` and `/storage-wars` out of this route into the
// framework's own error page instead of the site's not-found view (FR-014).
Route::get('/{path?}', [ShellController::class, 'show'])
    ->where('path', '^(?!(api|up|sanctum|storage)(/|$)).*$');
