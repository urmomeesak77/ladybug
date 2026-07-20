<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminUserResource;
use App\Services\UserAdminService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Admin account console API. The whole controller mounts behind auth:sanctum + role:admin
 * (routes/api.php), so every method here already has an admin-or-higher caller — the boundary
 * protects the DATA, not just the SPA page (Principle VI). The disable/enable transitions take
 * the actor from the session, never the request body (FR-008b), and return the updated row so
 * the SPA refreshes it in place without leaving the current page (FR-016).
 */
class UserAdminController extends Controller {
    public function __construct(private readonly UserAdminService $service) {
    }

    /**
     * GET /api/admin/users — one 100-row page of every account, newest-first. `page`
     * (default 1) selects the page; a non-numeric, missing or below-1 value falls back to 1,
     * and a page beyond the last is an empty page, not an error.
     */
    public function index(Request $request): AnonymousResourceCollection {
        $page = max(1, (int) $request->query('page', '1'));

        return AdminUserResource::collection($this->service->paginate($page));
    }

    /**
     * POST /api/admin/users/{hash}/disable — revoke the account's access and return the
     * updated row. Unknown hash → 404. The actor is the signed-in admin, not the body.
     */
    public function disable(Request $request, string $hash): JsonResource {
        return new AdminUserResource($this->service->disable($request->user(), $hash));
    }

    /**
     * POST /api/admin/users/{hash}/enable — restore the account's access; returns the row.
     */
    public function enable(Request $request, string $hash): JsonResource {
        return new AdminUserResource($this->service->enable($request->user(), $hash));
    }
}
