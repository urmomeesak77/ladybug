<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\RememberMe;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Re-queues the "remember me" flag cookie on authenticated requests so its
 * Max-Age resets with each activity. Without this step, the 7-day window would
 * count from login time (FR-004 violation); with it, the window slides to start
 * from the last authenticated activity (decision D2 from research.md).
 * Registered as an append on the `api` group in `bootstrap/app.php`.
 */
final class SlideRememberMeCookie {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        $response = $next($request);

        // Explicitly the 'web' guard, not $request->user()'s ambient default: routes behind
        // `auth:sanctum` (e.g. logout) switch the request's default guard to 'sanctum' before
        // the controller runs (Authenticate::shouldUse), and that guard independently caches
        // its own resolved user. AuthController::logout()/EnsureAccountEnabled only log out
        // 'web', so checking the default guard here would still see a stale authenticated user
        // and re-queue the cookie logout just cleared (FR-005/SC-004).
        if ($request->user('web') !== null && $request->hasCookie(config('remember.cookie'))) {
            RememberMe::queue();
        }

        return $response;
    }
}
