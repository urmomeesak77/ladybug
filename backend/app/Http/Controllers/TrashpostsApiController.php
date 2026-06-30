<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\CreatePostRequest;
use App\Http\Resources\TrashpostResource;
use App\Models\Trashpost;
use App\Services\TrashpostImageProcessor;
use App\Services\TrashpostService;
use App\Utils\Str;
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
     * GET /api/posts/{hash} — a single visible post, or 404 when no visible post matches
     * (unknown, not activated, or soft-deleted all resolve to null in the service).
     */
    public function show(string $hash): TrashpostResource {
        $post = $this->service->findVisibleByHash($hash);
        if ($post === null) {
            abort(404);
        }

        return new TrashpostResource($post);
    }

    /**
     * POST /api/posts — create a meme from an uploaded image or a YouTube link. Requires
     * authentication; the post is activated immediately so it appears in the feed.
     */
    public function store(CreatePostRequest $request, TrashpostImageProcessor $processor): JsonResponse {
        $hash = Str::createUniqueHash();
        $user = $request->user();
        $attributes = [
            'hash' => $hash,
            'title' => $request->input('title'),
            'user_id' => $user->id,
            'username' => $user->name,
        ];

        if ($request->hasFile('image')) {
            $attributes = array_merge($attributes, $processor->process($request->file('image'), $hash));
        }
        else {
            $attributes['type'] = 'youtube';
            $attributes['youtube'] = Youtube::extractId((string) $request->input('youtube'));
        }

        $post = new Trashpost($attributes);
        $post->activated_at = now();
        $post->save();

        return (new TrashpostResource($post))->response()->setStatusCode(201);
    }
}
