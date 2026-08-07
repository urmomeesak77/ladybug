<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\CommentModerationController;
use App\Http\Controllers\Admin\ModerationController;
use App\Http\Controllers\Admin\UserAdminController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CommentController;
use App\Http\Controllers\EmailVerificationController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\TrashpostsApiController;
use Database\Seeders\E2eSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;

// Liveness probe for the dev environment and CI. Intentionally has no database
// dependency so it answers before any migrations exist. See contracts/health.md.
Route::get('/health', static fn () => response()->json(['status' => 'ok']));

// Test-only: reset the disposable e2e database to the pristine seed. The Playwright suite
// runs every spec serially against one shared stack, and each spec's assertions assume the
// baseline corpus (20 posts, the newest carrying 3 comments); destructive specs (deactivating
// a meme, adding a comment) would otherwise leak state into later specs. The e2e harness calls
// this before each test so every test starts identical and order-independent. Gated to the
// `e2e` environment, so the route does NOT exist in dev ('local') or production — it is never
// registered off the isolated docker-compose.e2e.yml stack (backend/.env.e2e sets APP_ENV=e2e).
if (app()->environment('e2e')) {
    Route::post('/testing/reset', static function () {
        Artisan::call('migrate:fresh', [
            '--force' => true,
            '--seed' => true,
            '--seeder' => E2eSeeder::class,
        ]);

        // migrate:fresh restarts the users AUTO_INCREMENT, so tests reuse low ids; the
        // rate-limiter counters live in the (file) cache, which migrate:fresh leaves
        // untouched. Without this, an inline throttle keyed by user id (sha1(id), no route
        // component — e.g. the verify/resend routes) carries hits across tests that reuse an
        // id, and a fast run trips "Too many attempts". Flush the cache so throttle state
        // resets with the data.
        Artisan::call('cache:clear');

        return response()->noContent();
    })->name('api.testing.reset');
}

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

// Comments on a post, addressed by the post's public hash (015). Reading is public and
// viewer-aware (a non-public post is 404, an admin also sees hidden rows). Creating is gated
// exactly like uploads — signed in AND verified — and throttled per user (contracts, D8). The
// create controller method lands in US2.
Route::get('/posts/{hash}/comments', [CommentController::class, 'index'])->name('api.posts.comments.index');
Route::post('/posts/{hash}/comments', [CommentController::class, 'store'])
    ->middleware(['auth:sanctum', 'verified', 'throttle:comments'])
    ->name('api.posts.comments.store');

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
// Own-account profile edit: the display name only, and only for the signed-in account
// (no target parameter — the session names the row). A taken name is a 422.
Route::patch('/user', [AuthController::class, 'updateProfile'])
    ->middleware('auth:sanctum')
    ->name('api.auth.profile.update');
// Own-account password change (022, US3). Two things about this line are deliberate.
// PUT, where its neighbour above is PATCH: that endpoint sends a PARTIAL account — one
// field of several, the others left alone — while this one addresses a single credential
// at its own URL and replaces it whole; there is no partial password, so the verbs differ
// because the requests do. And `throttle:password` keys by the ACCOUNT id here, not the IP
// (the route is authenticated), so a borrowed session cannot be turned into an offline-speed
// oracle for the password it did not come with (FR-030, research D7).
Route::put('/user/password', [AuthController::class, 'updatePassword'])
    ->middleware(['auth:sanctum', 'throttle:password'])
    ->name('api.auth.password.update');

// Password recovery (022). Anonymous and session-free: the account is the one the
// submitted address names, never the signed-in one. The 200 is UNCONDITIONAL — the same
// status, body and headers for a real account, an unknown address, a disabled account, a
// re-send inside the broker's interval, and a failed mail transport alike (FR-004). The
// `password` limiter is a separate bucket from `auth` at the same cap, so exhausting the
// recovery allowance never blocks signing in with a remembered password (research D7).
Route::post('/password/forgot', [PasswordResetController::class, 'request'])
    ->middleware('throttle:password')
    ->name('api.password.forgot');
// Is this link still alive? A READ (204/403) that consumes nothing (FR-012), called once
// when the page opens so a dead link is refused before a password is typed. It is a POST
// with a body rather than a GET with a query for the same reason the token rides in the
// link's fragment: a `?token=…` would put the secret straight into nginx's access log, one
// layer below the fragment that was chosen to keep it out (research D2/D8).
Route::post('/password/reset/check', [PasswordResetController::class, 'check'])
    ->middleware('throttle:password')
    ->name('api.password.reset.check');
// Spend the link. Session-free like the two above: the account is the one the digest names,
// and completing a reset establishes NO session — the caller is told to log in (FR-021).
Route::post('/password/reset', [PasswordResetController::class, 'reset'])
    ->middleware('throttle:password')
    ->name('api.password.reset');

// Admin moderation console (010). The whole group is gated by auth:sanctum (guest → 401)
// then role:admin (member → 403; admin/superuser through) — the boundary protects the
// DATA, not just the SPA page (contracts/admin-moderation-api.md, Principle VI). The
// action routes (activate/deactivate/delete/restore) land in US3/US4.
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function () {
    Route::get('/posts', [ModerationController::class, 'index'])->name('api.admin.posts.index');
    Route::post('/posts/{hash}/activate', [ModerationController::class, 'activate'])->name('api.admin.posts.activate');
    Route::post('/posts/{hash}/deactivate', [ModerationController::class, 'deactivate'])->name('api.admin.posts.deactivate');
    Route::delete('/posts/{hash}', [ModerationController::class, 'destroy'])->name('api.admin.posts.destroy');
    Route::delete('/posts/{hash}/purge', [ModerationController::class, 'purge'])->name('api.admin.posts.purge');
    Route::post('/posts/{hash}/restore', [ModerationController::class, 'restore'])->name('api.admin.posts.restore');

    // Admin account console (012). One 100-row page of every account, newest-first, plus the
    // per-row access transitions. Same admin+ boundary as the posts routes; both transitions
    // are set-to-target (idempotent), and the {hash} is the public handle — never a DB id.
    Route::get('/users', [UserAdminController::class, 'index'])->name('api.admin.users.index');
    Route::post('/users/{hash}/disable', [UserAdminController::class, 'disable'])->name('api.admin.users.disable');
    Route::post('/users/{hash}/enable', [UserAdminController::class, 'enable'])->name('api.admin.users.enable');
    // Permanent account deletion (013). Hard delete guarded by the same strict-rank rule; the
    // account's memes orphan and any account it disabled loses only the actor name, via the
    // existing nullOnDelete FKs (contracts/admin-user-delete-api.md). {hash} is the public handle.
    Route::delete('/users/{hash}', [UserAdminController::class, 'destroy'])->name('api.admin.users.destroy');

    // Comment moderation (015), keyed by the comment's public hash. Reversible hide/unhide and
    // a hard delete; same admin+ boundary as the posts/users routes (contracts/admin-comments-api.md).
    // The destroy route (US4) lands alongside.
    Route::post('/comments/{hash}/hide', [CommentModerationController::class, 'hide'])->name('api.admin.comments.hide');
    Route::post('/comments/{hash}/unhide', [CommentModerationController::class, 'unhide'])->name('api.admin.comments.unhide');
    // Permanent (hard) comment deletion (US4): irreversible, supersedes hidden (contracts).
    Route::delete('/comments/{hash}', [CommentModerationController::class, 'destroy'])->name('api.admin.comments.destroy');
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
