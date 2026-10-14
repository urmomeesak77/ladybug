<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Cookie;

/**
 * Wrapper for the "remember me" flag cookie. The flag is presence-only, carries no
 * secret, and is the entire "was this login remembered" record—no database column
 * needed per decision D2 (research.md). This class centralizes cookie name/lifetime
 * configuration via config('remember.*'), making it testable and reusable across
 * AuthController, middleware, and related flows.
 */
final class RememberMe {
    /** Session key recording whether this sign-in chose "remember me" (see ExpireIdleSessions). */
    public const SESSION_FLAG = 'remember_me';

    /** Session key holding the Unix time of the session's last request. */
    public const LAST_SEEN = 'last_seen_at';

    public static function queue(): void {
        Cookie::queue(config('remember.cookie'), '1', config('remember.lifetime'));
    }

    /**
     * Stamp a fresh sign-in as NOT remembered (the `Login` event listener). Every door —
     * password, registration, Google — fires that event, so every session carries the flag
     * ExpireIdleSessions checks; AuthController::login flips it with markRemembered().
     */
    public static function stampSignIn(): void {
        if (! app()->bound('session.store') || ! session()->isStarted()) {
            return;
        }

        session()->put(self::SESSION_FLAG, false);
        session()->put(self::LAST_SEEN, time());
    }

    public static function markRemembered(): void {
        session()->put(self::SESSION_FLAG, true);
    }

    public static function forget(): void {
        Cookie::queue(Cookie::forget(config('remember.cookie')));
    }
}
