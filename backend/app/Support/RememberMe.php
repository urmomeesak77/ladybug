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
    public static function queue(): void {
        Cookie::queue(config('remember.cookie'), '1', config('remember.lifetime'));
    }

    public static function forget(): void {
        Cookie::queue(Cookie::forget(config('remember.cookie')));
    }
}
