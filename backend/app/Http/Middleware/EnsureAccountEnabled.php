<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\RememberMe;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Live-session revocation (FR-014, research D3). Appended to the api group after Sanctum's
 * stateful middleware, so the session is started and the user resolved by the time it runs.
 * When the resolved account is disabled it tears the session down — logout, invalidate,
 * rotate the CSRF token, clear the remember cookie (FR-006, 018) — and answers 401 so the
 * dead cookies cannot be replayed; the SPA reads any non-ok /api/user probe as anonymous, so
 * it drops to the logged-out UI with no new client code. An active or unauthenticated request
 * passes straight through.
 */
final class EnsureAccountEnabled {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        $user = $request->user();
        if ($user === null || ! $user->isDisabled()) {
            return $next($request);
        }

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        RememberMe::forget();

        return response()->json(['message' => 'This account is disabled.'], 401);
    }
}
