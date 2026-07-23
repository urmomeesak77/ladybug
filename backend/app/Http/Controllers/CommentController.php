<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Resources\CommentResource;
use App\Services\CommentService;
use App\Services\TrashpostService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class CommentController extends Controller {
    public function __construct(
        private readonly CommentService $comments,
        private readonly TrashpostService $posts,
    ) {
    }

    /**
     * GET /api/posts/{hash}/comments — one newest-first batch of a post's comments plus the
     * public count and the older-comments cursor. The post is resolved viewer-aware exactly
     * like GET /api/posts/{hash}: a post the caller may not see resolves to 404, so the
     * comment section of a non-public post is unreachable through public views (contracts).
     * The session, when present, elevates what is returned (an admin also sees hidden rows).
     */
    public function index(Request $request, string $hash): AnonymousResourceCollection {
        $viewer = $request->user();
        $post = $this->posts->findViewableByHash($hash, $viewer);
        if ($post === null) {
            abort(404);
        }

        $page = $this->comments->list($post, $request->query('before'), $viewer);

        return CommentResource::collection($page['comments'])->additional([
            'meta' => [
                'total' => $page['total'],
                'next_cursor' => $page['next_cursor'],
                'has_more' => $page['has_more'],
            ],
        ]);
    }
}
