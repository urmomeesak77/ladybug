<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminUserResource;
use App\Services\UserAdminService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Admin account console API. The whole controller mounts behind auth:sanctum + role:admin
 * (routes/api.php), so every method here already has an admin-or-higher caller — the boundary
 * protects the DATA, not just the SPA page (Principle VI). The disable/enable transitions
 * arrive in US3.
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
}
