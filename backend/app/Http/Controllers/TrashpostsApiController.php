<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\CreatePostRequest;
use App\Http\Resources\TrashpostResource;
use App\Services\TrashpostService;
use App\Utils\Youtube;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class TrashpostsApiController extends Controller {
    public function __construct(private readonly TrashpostService $service) {
    }

    /**
     * GET /api/posts — the newest visible posts as a bounded, cursor-paged feed.
     */
    public function index(Request $request): AnonymousResourceCollection {
        return TrashpostResource::collection($this->service->feed($request->query()));
    }

    /**
     * GET /api/posts/{hash} — a single post the caller may view, else 404.
     *
     * Public posts are returned to anyone; a hidden post (pending, deactivated, or
     * soft-deleted) is returned only to an admin+ or, unless it is soft-deleted, to its
     * uploader. The route stays public — `$request->user()` resolves from the Sanctum
     * session when present and is null for a guest (same pattern as GET /api/user).
     */
    public function show(Request $request, string $hash): TrashpostResource {
        $post = $this->service->findViewableByHash($hash, $request->user());
        if ($post === null) {
            abort(404);
        }

        return new TrashpostResource($post);
    }

    /**
     * POST /api/posts — create a meme from an uploaded image or a YouTube link. Requires
     * authentication; the service activates the post so it appears in the feed.
     */
    public function store(CreatePostRequest $request): JsonResponse {
        // CreatePostRequest guarantees exactly one of image/youtube/video; a null id
        // means the upload is an image or a video, neither of which carries a YouTube id.
        $youtubeId = $request->hasFile('image') || $request->hasFile('video')
            ? null
            : Youtube::extractId((string) $request->input('youtube'));

        // Asked of the RAW input, which is the only place the Shorts shape survives —
        // extraction keeps just the bare id (Principle VI) and throws the URL away.
        $isShort = $youtubeId !== null && Youtube::isShort((string) $request->input('youtube'));

        $post = $this->service->createPost(
            $request->user(),
            $request->input('title'),
            $request->file('image'),
            $youtubeId,
            $request->file('video'),
            $isShort,
        );

        return (new TrashpostResource($post))->response()->setStatusCode(201);
    }
}
