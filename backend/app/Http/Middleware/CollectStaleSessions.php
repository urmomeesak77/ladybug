<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\SessionGarbageCollector;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replaces Laravel's own request-triggered session GC (disabled via `session.lottery` in
 * config/session.php — see SessionGarbageCollector's docblock for why it was unsafe here) with
 * a lottery that always sweeps against the fixed, safe `remember.lifetime` floor. Registered as
 * a prepend on both the `api` and `web` groups in `bootstrap/app.php`, mirroring
 * ApplyRememberMeLifetime.
 */
final class CollectStaleSessions {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        SessionGarbageCollector::sweepIfLucky();

        return $next($request);
    }
}
