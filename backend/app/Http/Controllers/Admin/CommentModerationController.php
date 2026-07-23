<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Services\CommentService;

/**
 * Admin comment moderation, keyed by the comment's public hash (never a DB id, Principle V).
 * Mounted inside the admin group (auth:sanctum + role:admin), so every caller is already
 * admin-or-higher — no per-action role code. An unknown hash resolves to 404 (contracts).
 */
class CommentModerationController extends Controller {
    public function __construct(private readonly CommentService $comments) {
    }

    /**
     * POST /api/admin/comments/{hash}/hide — remove the comment from public view (retained,
     * still visible to admins). Idempotent; returns the updated row.
     */
    public function hide(string $hash): CommentResource {
        return new CommentResource($this->comments->hide($this->find($hash)));
    }

    /**
     * POST /api/admin/comments/{hash}/unhide — restore a hidden comment to public view.
     * Idempotent; returns the updated row.
     */
    public function unhide(string $hash): CommentResource {
        return new CommentResource($this->comments->unhide($this->find($hash)));
    }

    /**
     * Resolve a comment by its public hash, or 404. Hidden comments resolve too, so a hidden
     * comment stays reachable for unhide/delete.
     */
    private function find(string $hash): Comment {
        return Comment::where('hash', $hash)->firstOrFail();
    }
}
