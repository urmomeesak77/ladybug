<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a cookieless page read from minting a `sessions` row.
 *
 * Every crawler hit on the shell, robots.txt, the sitemaps and the unfurl image arrives
 * without a session cookie, and StartSession used to INSERT one row per hit — kept until GC,
 * on a 96M buffer pool. Such a request is anonymous by definition (no cookie, no account), so
 * nothing it could put in a session is worth storing: it runs on the in-memory driver instead.
 * The response still carries a fresh session cookie, so a real browser gets its ordinary row
 * on its very next request — the SPA's own /api/user probe — and nothing about a signed-in
 * visit changes.
 *
 * `api/*` and `sanctum/*` are left alone: the Google sign-in door is a GET in this group that
 * must persist its OAuth state, and /sanctum/csrf-cookie hands out a token the next POST is
 * checked against — both even for a browser arriving with no cookie at all.
 *
 * Prepended to the `web` group so the driver is switched before StartSession resolves it.
 */
final class SkipSessionForCookielessReads {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        if ($this->isCookielessRead($request)) {
            config(['session.driver' => 'array']);
        }

        return $next($request);
    }

    private function isCookielessRead(Request $request): bool {
        return $request->isMethodSafe()
            && ! $request->cookies->has((string) config('session.cookie'))
            && ! $request->is('api/*', 'sanctum/*');
    }
}
