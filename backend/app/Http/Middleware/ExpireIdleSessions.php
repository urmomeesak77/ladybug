<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\RememberMe;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ends a signed-in session that was NOT remembered once it has idled past the plain
 * session lifetime — whatever cookies arrive beside it.
 *
 * ApplyRememberMeLifetime has to decide the session lifetime before the session exists, so it
 * can only look at the remember cookie's presence, and that cookie is a bare flag a client
 * controls. On its own it let anyone holding a stolen, unremembered session cookie add
 * `{app}-remember=x` and keep the session alive for a week. The session's own record of the
 * choice (stamped at sign-in, set true only by AuthController::login) is what this checks
 * instead, after the session has been read.
 *
 * A session with no flag at all predates this check and is left alone rather than logged out
 * on deploy; such rows age out within remember.lifetime on their own.
 */
final class ExpireIdleSessions {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        if ($request->hasSession() && $request->user('web') !== null) {
            $this->enforce($request);
        }

        return $next($request);
    }

    private function enforce(Request $request): void {
        $session = $request->session();
        $lastSeen = $session->get(RememberMe::LAST_SEEN);
        $idleLimit = (int) config('remember.idle_lifetime') * 60;

        if ($session->get(RememberMe::SESSION_FLAG) === false && is_int($lastSeen) && time() - $lastSeen > $idleLimit) {
            Auth::guard('web')->logout();
            $session->invalidate();
            $session->regenerateToken();

            return;
        }

        $session->put(RememberMe::LAST_SEEN, time());
    }
}
