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
 * Registration and middleware ordering is handled by T009, not this task.
 */
final class SlideRememberMeCookie {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        $response = $next($request);

        if ($request->user() !== null && $request->hasCookie(config('remember.cookie'))) {
            RememberMe::queue();
        }

        return $response;
    }
}
