<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Stashes the account the request arrived as, for RecordAccessLog to read on the way out
 * (FR-008a, research D2). It changes nothing about the request or the response.
 *
 * Why it exists as a separate middleware at all: RecordAccessLog has to be the OUTERMOST
 * frame to see rejections and rendered exceptions (research D1), and at that depth the
 * session has not been started yet — Sanctum injects the web group, StartSession included,
 * from inside the api group — so no account is resolvable on the way in. Resolving one on
 * the way OUT returns the END state, which for POST /api/login, POST /api/register and the
 * recovery-link reset is an account that did not exist when the request arrived. That is
 * exactly the attribution FR-008b forbids, so the arrival-time answer is captured here, at
 * the first point the session is live, and the outer frame reads it.
 *
 * $request->user() with no guard argument is correct here BECAUSE this is a before-phase:
 * route middleware has not run yet, so the default guard is still `web`. The same call in
 * an after-phase would read whichever guard `auth:sanctum` switched to mid-request.
 */
final class CaptureAccessLogActor {
    public const ATTRIBUTE = 'access_log.user_id';

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        $request->attributes->set(self::ATTRIBUTE, $request->user()?->getAuthIdentifier());

        return $next($request);
    }
}
