<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\CreateCommentRequest;
use App\Http\Resources\CommentResource;
use App\Services\CommentService;
use App\Services\TrashpostService;
use Illuminate\Http\JsonResponse;
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

    /**
     * POST /api/posts/{hash}/comments — create a comment on the post. The route middleware
     * (auth:sanctum + verified + throttle:comments) has already enforced the gate, so the
     * caller is a verified account. The post is resolved viewer-aware (404 if not viewable);
     * the created row is returned as a single CommentResource with 201 (contracts).
     */
    public function store(CreateCommentRequest $request, string $hash): JsonResponse {
        $author = $request->user();
        $post = $this->posts->findViewableByHash($hash, $author);
        if ($post === null) {
            abort(404);
        }

        $comment = $this->comments->create($post, $author, $request->string('body')->toString());

        return (new CommentResource($comment))->response()->setStatusCode(201);
    }
}
