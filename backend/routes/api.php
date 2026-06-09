<?php

declare(strict_types=1);

use App\Http\Controllers\TrashpostsApiController;
use Illuminate\Support\Facades\Route;

// Liveness probe for the dev environment and CI. Intentionally has no database
// dependency so it answers before any migrations exist. See contracts/health.md.
Route::get('/health', static fn () => response()->json(['status' => 'ok']));

// Read-side feed API (public, read-only). The show route is registered here so
// `url_api` resolves now; its controller method lands in US2 (contracts/feed-api.md).
Route::get('/posts', [TrashpostsApiController::class, 'index'])->name('api.posts.index');
Route::get('/posts/{hash}', [TrashpostsApiController::class, 'show'])->name('api.posts.show');
