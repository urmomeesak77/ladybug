<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Http\Middleware\ApplyRememberMeLifetime;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Exercises `ApplyRememberMeLifetime` in isolation: it is not yet registered
 * globally (that's T009), so this test mounts it on a throwaway probe route.
 */
final class ApplyRememberMeLifetimeTest extends TestCase {
    /**
     * The probe lives under /api because routes/web.php ends in the SPA shell
     * catch-all, which claims every address outside `api|up|sanctum|storage`. A
     * route registered here in a test is registered LAST and would lose to it.
     */
    protected function setUp(): void {
        parent::setUp();

        Route::middleware([ApplyRememberMeLifetime::class])
            ->get('/api/_test/remember-me-lifetime', static fn () => response()->json([
                'lifetime' => config('session.lifetime'),
            ]));
    }

    public function test_cookie_present_raises_session_lifetime(): void {
        // getJson()/json() only attach cookies when withCredentials() is set
        // (see prepareCookiesForJsonRequest() in Laravel's MakesHttpRequests) —
        // without it, withCookie()/withUnencryptedCookie() are silently dropped.
        $this->withCredentials()
            ->withUnencryptedCookie((string) config('remember.cookie'), '1')
            ->getJson('/api/_test/remember-me-lifetime')
            ->assertOk()
            ->assertJson(['lifetime' => config('remember.lifetime')]);
    }

    public function test_cookie_absent_leaves_session_lifetime_untouched(): void {
        $baseline = config('session.lifetime');

        $this->getJson('/api/_test/remember-me-lifetime')
            ->assertOk()
            ->assertJson(['lifetime' => $baseline]);
    }
}
