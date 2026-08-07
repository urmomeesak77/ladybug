<?php

declare(strict_types=1);

namespace Tests\Unit\Providers;

use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

/**
 * The `password` named limiter (research D7). It is deliberately its own bucket rather
 * than a second consumer of `auth`: exhausting the recovery cap must never lock a visitor
 * out of signing in with the password they do remember. Laravel namespaces a named
 * limiter's counter by the limiter name, so that separation follows from registering it
 * under its own name — the end-to-end proof that tripping `throttle:password` leaves
 * `POST /api/login` answering lives in PasswordResetControllerTest (T011), where real
 * requests can show it.
 *
 * What is asserted here is what this application chose: the cap comes from configuration,
 * and the counter is keyed per-account once a session exists (so one signed-in account
 * cannot spend a shared-IP office's whole allowance) and per-IP before it does.
 */
final class AppServiceProviderTest extends TestCase {
    public function test_the_password_limiter_is_registered_under_its_own_name(): void {
        $this->assertNotNull(RateLimiter::limiter('password'));
    }

    public function test_the_password_limiter_takes_its_cap_from_configuration(): void {
        config(['app.auth_throttle' => 17]);

        $this->assertSame(17, $this->passwordLimitFor(Request::create('/'))->maxAttempts);
    }

    public function test_an_anonymous_request_is_counted_against_its_ip(): void {
        $request = Request::create('/', 'POST', server: ['REMOTE_ADDR' => '203.0.113.7']);

        $this->assertSame('203.0.113.7', $this->passwordLimitFor($request)->key);
    }

    public function test_a_signed_in_request_is_counted_against_the_account_not_the_ip(): void {
        $user = new User();
        $user->id = 42;
        $request = Request::create('/', 'POST', server: ['REMOTE_ADDR' => '203.0.113.7']);
        $request->setUserResolver(static fn () => $user);

        $this->assertSame('42', $this->passwordLimitFor($request)->key);
    }

    private function passwordLimitFor(Request $request): Limit {
        $limiter = RateLimiter::limiter('password');

        return $limiter($request);
    }
}
