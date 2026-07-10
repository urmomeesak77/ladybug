<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\AdminTrashpostResource;
use App\Services\ModerationService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;

/**
 * Admin moderation console API. The whole controller mounts behind auth:sanctum + role:admin
 * (routes/api.php), so every method here already has an admin-or-higher caller. State
 * transitions (activate/deactivate/delete/restore) arrive in US3/US4.
 */
class ModerationController extends Controller {
    public function __construct(private readonly ModerationService $service) {
    }

    /**
     * GET /api/admin/posts — one 100-row page of every meme, newest-first. `page` (default 1)
     * selects the page; a page beyond the last is an empty page, not an error.
     */
    public function index(Request $request): AnonymousResourceCollection {
        $page = max(1, (int) $request->query('page', '1'));

        return AdminTrashpostResource::collection($this->service->paginate($page));
    }

    /**
     * POST /api/admin/posts/{hash}/activate — mark the meme activated and return the updated
     * row so the client refreshes it in place without leaving the current page (FR-017).
     */
    public function activate(string $hash): JsonResource {
        return new AdminTrashpostResource($this->service->activate($hash));
    }

    /**
     * POST /api/admin/posts/{hash}/deactivate — clear activation; returns the updated row.
     */
    public function deactivate(string $hash): JsonResource {
        return new AdminTrashpostResource($this->service->deactivate($hash));
    }

    /**
     * DELETE /api/admin/posts/{hash} — soft-delete the meme (retained, hidden from public
     * views) and return the updated row (`deleted: true`). The client confirms first (FR-016).
     */
    public function destroy(string $hash): JsonResource {
        return new AdminTrashpostResource($this->service->delete($hash));
    }

    /**
     * POST /api/admin/posts/{hash}/restore — undelete the meme; returns the updated row.
     */
    public function restore(string $hash): JsonResource {
        return new AdminTrashpostResource($this->service->restore($hash));
    }

    /**
     * DELETE /api/admin/posts/{hash}/purge — hard-delete the meme: the row is removed for
     * good and its media files are deleted from disk. Irreversible, hence a dedicated route
     * (a client bug on the soft-delete route can never escalate). 204: there is no updated
     * row to return — the client drops the row. The client confirms first (FR-016).
     */
    public function purge(string $hash): Response {
        $this->service->purge($hash);

        return response()->noContent();
    }
}
