<?php

declare(strict_types=1);

use App\Http\Controllers\GoogleAuthController;
use App\Http\Controllers\RobotsController;
use App\Http\Controllers\ShellController;
use App\Http\Controllers\SitemapController;
use Illuminate\Support\Facades\Route;

// The Google sign-in round trip. These two live HERE, in the `web` group, rather than
// in routes/api.php with every other auth endpoint — and that is a mechanism, not a
// preference (research D2).
//
// Sanctum's EnsureFrontendRequestsAreStateful starts a session only for requests whose
// Origin/Referer matches SANCTUM_STATEFUL_DOMAINS. The callback arrives as a top-level
// navigation FROM accounts.google.com, so under the `api` group it would be stateless
// and there would be no session to read the `state` back from — the flow would fail its
// own CSRF check on every single attempt.
//
// They keep the /api prefix so nginx and the SPA dev proxy route them to the backend
// exactly as they route the rest of the API, and they are registered ABOVE the shell
// catch-all below because route order is the whole of what keeps the SPA from
// swallowing them.
Route::prefix('api')->group(function (): void {
    Route::get('/auth/google/redirect', [GoogleAuthController::class, 'redirect'])->name('api.auth.google.redirect');
    Route::get('/auth/google/callback', [GoogleAuthController::class, 'callback'])->name('api.auth.google.callback');
});

// The crawler-facing addresses, registered ABOVE the shell catch-all below —
// route order is the whole of what keeps the SPA from swallowing them (FR-022).
//
// Do NOT add frontend/public/robots.txt or frontend/public/sitemap.xml. Anything
// in public/ becomes a real file in dist/, and nginx's `try_files $uri` would then
// win against these routes and silently serve a static stub instead. The same trap
// is why backend/public/robots.txt (the Laravel skeleton's `Disallow:` stub) was
// deleted with this route: wherever Laravel's own public/ is the document root —
// `artisan serve` in dev — that file shadowed this route and answered every crawler
// with an empty rule set. No test can catch it; the suite calls the app directly and
// never consults public/.
Route::get('/robots.txt', [RobotsController::class, 'show']);
Route::get('/sitemap.xml', [SitemapController::class, 'index']);
Route::get('/sitemaps/static.xml', [SitemapController::class, 'static']);
Route::get('/sitemaps/posts-{page}.xml', [SitemapController::class, 'posts']);

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
