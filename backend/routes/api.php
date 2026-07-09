<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\ModerationController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\EmailVerificationController;
use App\Http\Controllers\TrashpostsApiController;
use Illuminate\Support\Facades\Route;

// Liveness probe for the dev environment and CI. Intentionally has no database
// dependency so it answers before any migrations exist. See contracts/health.md.
Route::get('/health', static fn () => response()->json(['status' => 'ok']));

// Read-side feed API (public, read-only). The show route is registered here so
// `url_api` resolves now; its controller method lands in US2 (contracts/feed-api.md).
Route::get('/posts', [TrashpostsApiController::class, 'index'])->name('api.posts.index');
Route::get('/posts/{hash}', [TrashpostsApiController::class, 'show'])->name('api.posts.show');

// Create a post (image upload or YouTube link). Authenticated only (Sanctum SPA session)
// AND verified-email only ('verified' = EnsureEmailIsVerified, 403 otherwise) — the
// enforcement spec 008 deferred to contribution features. Throttled per user: uploads
// are heavier than reads (image processing, disk writes).
Route::post('/posts', [TrashpostsApiController::class, 'store'])
    ->middleware(['auth:sanctum', 'verified', 'throttle:uploads'])
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

// Admin moderation console (010). The whole group is gated by auth:sanctum (guest → 401)
// then role:admin (member → 403; admin/superuser through) — the boundary protects the
// DATA, not just the SPA page (contracts/admin-moderation-api.md, Principle VI). The
// action routes (activate/deactivate/delete/restore) land in US3/US4.
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('/posts', [ModerationController::class, 'index'])->name('api.admin.posts.index');
});

// Email verification (008). {hash} is sha1 of the recipient's email — never a DB
// id (research D3). Deliberately session-free: possession of the signed link
// alone proves control of the inbox, so it verifies even in a logged-out
// browser (the account is resolved from the digest; a session, when present,
// only adds the cross-account refusal). The signature is validated over the
// RELATIVE url (signed:relative) because the email wraps this route in the SPA
// origin, which differs from the API's. The route name is what
// AppServiceProvider's link builder signs against.
Route::get('/email/verify/{hash}', [EmailVerificationController::class, 'verify'])
    ->middleware(['signed:relative', 'throttle:6,1'])
    ->name('verification.verify');
// Resend the verification message (FR-006): rate-limited per user like the verify
// route — a signed-in user can mint at most 6 fresh links per minute.
Route::post('/email/verification-notification', [EmailVerificationController::class, 'send'])
    ->middleware(['auth:sanctum', 'throttle:6,1'])
    ->name('verification.send');
