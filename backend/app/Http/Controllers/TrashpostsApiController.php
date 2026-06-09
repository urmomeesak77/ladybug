<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Resources\TrashpostResource;
use App\Services\TrashpostService;
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
}
