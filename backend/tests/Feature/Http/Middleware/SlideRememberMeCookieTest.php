<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Http\Middleware\SlideRememberMeCookie;
use App\Models\User;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Exercises `SlideRememberMeCookie` in isolation: it is not yet registered
 * globally (that's T009), so this test mounts it on a throwaway probe route.
 * It only re-queues the remember cookie when a user was resolved AND the
 * flag cookie was already present on the incoming request.
 */
final class SlideRememberMeCookieTest extends TestCase {
    use RefreshDatabase;

    /**
     * The probe lives under /api because routes/web.php ends in the SPA shell
     * catch-all, which claims every address outside `api|up|sanctum|storage`. A
     * route registered here in a test is registered LAST and would lose to it.
     */
    protected function setUp(): void {
        parent::setUp();

        // AddQueuedCookiesToResponse must wrap SlideRememberMeCookie (listed before it here)
        // so its after-phase — which attaches queued cookies to the outgoing response — runs
        // AFTER SlideRememberMeCookie's own after-phase queues the cookie. Middleware pipelines
        // nest onion-style: earlier entries are outer layers whose "after" code runs last. In
        // the real app this wrapping comes from Sanctum's statefulApi() pipeline; it's not
        // present here since this route is deliberately outside the `api` group (T009 wires
        // real registration), so the test supplies it directly.
        Route::middleware(['auth:sanctum', AddQueuedCookiesToResponse::class, SlideRememberMeCookie::class])
            ->get('/api/_test/slide-remember-me', static fn () => response()->json(['ok' => true]));

        // No auth:sanctum here on purpose: that guard would 401 an anonymous request BEFORE
        // $next($request) ever reaches SlideRememberMeCookie, which would only prove the guard
        // rejects guests — not that SlideRememberMeCookie itself declines to slide for a null
        // user. This route mirrors the real T009 shape, where the middleware sits on the whole
        // `api` group unconditionally, including public routes an anonymous request can reach.
        Route::middleware([AddQueuedCookiesToResponse::class, SlideRememberMeCookie::class])
            ->get('/api/_test/slide-remember-me-guest', static fn () => response()->json(['ok' => true]));
    }

    public function test_authenticated_with_flag_cookie_slides_the_cookie(): void {
        $user = User::factory()->create();

        // getJson()/json() only attach cookies when withCredentials() is set
        // (see prepareCookiesForJsonRequest() in Laravel's MakesHttpRequests) —
        // without it, withCookie()/withUnencryptedCookie() are silently dropped.
        $response = $this->actingAs($user)
            ->withCredentials()
            ->withUnencryptedCookie((string) config('remember.cookie'), '1')
            ->getJson('/api/_test/slide-remember-me');

        // No EncryptCookies middleware runs on this bare probe route (see setUp() note), so
        // the queued cookie reaches the response unencrypted — assert against the raw value.
        $response->assertOk()
            ->assertCookie((string) config('remember.cookie'), '1', false);
    }

    public function test_authenticated_without_flag_cookie_does_not_slide(): void {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/_test/slide-remember-me');

        $response->assertOk()
            ->assertCookieMissing((string) config('remember.cookie'));
    }

    public function test_unauthenticated_with_flag_cookie_does_not_slide(): void {
        // Hits the guest-reachable probe (no auth:sanctum) so the request actually reaches
        // SlideRememberMeCookie::handle() with $request->user() === null, proving the
        // middleware itself — not just an auth guard upstream of it — declines to slide.
        $response = $this->withCredentials()
            ->withUnencryptedCookie((string) config('remember.cookie'), '1')
            ->getJson('/api/_test/slide-remember-me-guest');

        $response->assertOk()
            ->assertCookieMissing((string) config('remember.cookie'));
    }
}
