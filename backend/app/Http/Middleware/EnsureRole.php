<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\Role;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route gate: admits the authenticated user only when their role ranks at or above
 * the named minimum (e.g. `role:admin` admits admin and superuser). Authentication
 * is auth:sanctum's job — this runs after it, so the user is always present; a
 * lower rank is refused with 403.
 */
final class EnsureRole {
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next, string $role): Response {
        $required = Role::from($role);
        $user = $request->user();

        if ($user === null || $user->role->rank() < $required->rank()) {
            abort(403);
        }

        return $next($request);
    }
}
