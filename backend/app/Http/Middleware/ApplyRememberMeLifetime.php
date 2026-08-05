<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Extend session lifetime if a "remember me" cookie is present.
 *
 * This middleware runs before Sanctum's stateful-API pipeline (and therefore before
 * `EncryptCookies`), so the session lifetime is raised *before* the session is started/read
 * for this request. Because it executes ahead of `EncryptCookies`, it cannot decrypt the
 * cookie's value even if it wanted to — but it doesn't need to: the cookie carries no secret
 * or identity, only its *presence* matters (see research.md decision D3). Registration into
 * `bootstrap/app.php` is a separate task (T009) — do not edit `bootstrap/app.php` here.
 */
final class ApplyRememberMeLifetime {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        if ($request->hasCookie(config('remember.cookie'))) {
            config(['session.lifetime' => config('remember.lifetime')]);
        }

        return $next($request);
    }
}
