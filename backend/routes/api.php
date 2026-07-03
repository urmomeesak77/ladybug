<?php

declare(strict_types=1);

use App\Http\Controllers\AuthController;
use App\Http\Controllers\TrashpostsApiController;
use Illuminate\Support\Facades\Route;

// Liveness probe for the dev environment and CI. Intentionally has no database
// dependency so it answers before any migrations exist. See contracts/health.md.
Route::get('/health', static fn () => response()->json(['status' => 'ok']));

// Read-side feed API (public, read-only). The show route is registered here so
// `url_api` resolves now; its controller method lands in US2 (contracts/feed-api.md).
Route::get('/posts', [TrashpostsApiController::class, 'index'])->name('api.posts.index');
Route::get('/posts/{hash}', [TrashpostsApiController::class, 'show'])->name('api.posts.show');

// Create a post (image upload or YouTube link). Authenticated only (Sanctum SPA session).
// Throttled per user: uploads are heavier than reads (image processing, disk writes).
Route::post('/posts', [TrashpostsApiController::class, 'store'])
    ->middleware(['auth:sanctum', 'throttle:uploads'])
    ->name('api.posts.store');

// Auth (Sanctum SPA cookie-session). Register/login establish the session; the
// stateful middleware (bootstrap/app.php) starts it for requests from the SPA.
// Both use the named `auth` limiter (default 5/min, well below throttle:api's
// 60/min): login to slow credential guessing, register to slow bulk account
// creation (Principle VI). Limits are env-tunable — see AppServiceProvider.
Route::post('/register', [AuthController::class, 'register'])
    ->middleware('throttle:auth')
    ->name('api.auth.register');
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:auth')
    ->name('api.auth.login');
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum')->name('api.auth.logout');
// Public on purpose: returns the user when authenticated, else {data:null} (FR-005).
Route::get('/user', [AuthController::class, 'user'])->name('api.auth.user');
