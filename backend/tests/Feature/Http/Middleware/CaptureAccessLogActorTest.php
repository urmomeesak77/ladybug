<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Models\AccessLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

/**
 * Which account an entry names, and when it names none (FR-008, FR-008a, FR-008b).
 *
 * The recorder runs at a depth where the session has not started yet, so it cannot resolve
 * an account on the way in; resolving one on the way OUT would return the end state, which
 * for a sign-in or a registration is an account that did not exist when the request arrived.
 * CaptureAccessLogActor closes that gap by stashing the arrival-time account at the first
 * point the session is live (research D2).
 *
 * Every test here drives real cookie-carrying requests rather than actingAs(): actingAs()
 * installs a user resolver that answers at ANY depth, which would make the ordering this
 * file exists to prove invisible.
 */
final class CaptureAccessLogActorTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // Present as the SPA so Sanctum's stateful guard runs the browser path.
        $this->withHeader('Origin', 'http://localhost');
    }

    public function test_a_sign_in_names_no_account_but_keeps_the_submitted_address(): void {
        // FR-008b: the account a sign-in produced is NOT the account the request arrived as.
        // FR-008a/FR-016 keep the submitted identifier, which is what identifies the actor
        // on this row instead.
        User::factory()->create(['email' => 'ada@example.com']);

        $this->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password'])->assertOk();

        $entry = $this->entryFor('api/login');
        $this->assertNull($entry->user_id);
        $this->assertSame('ada@example.com', $entry->input['email']);
    }

    public function test_a_registration_names_no_account(): void {
        $this->postJson('/api/register', [
            'name' => 'Ada',
            'email' => 'ada@example.com',
            'password' => 'Password1',
            'password_confirmation' => 'Password1',
        ])->assertSuccessful();

        $this->assertNull($this->entryFor('api/register')->user_id);
    }

    public function test_an_anonymous_request_names_no_account(): void {
        $this->getJson('/api/user')->assertOk();

        $this->assertNull($this->entryFor('api/user')->user_id);
    }

    public function test_a_signed_in_request_names_the_account_it_arrived_as(): void {
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $session = $this->signIn('ada@example.com');

        $this->replay($session)->getJson('/api/user')->assertOk();

        $this->assertSame($user->id, $this->entryFor('api/user')->user_id);
    }

    public function test_signing_out_names_the_account_that_was_signed_in_on_arrival(): void {
        // The mirror image of the sign-in case: here the account exists on the way in and is
        // gone on the way out, so an after-phase reading would record nobody.
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $session = $this->signIn('ada@example.com');

        $this->replay($session)->postJson('/api/logout')->assertOk();

        $this->assertSame($user->id, $this->entryFor('api/logout')->user_id);
    }

    public function test_a_disabled_accounts_rejection_is_still_attributed_to_that_account(): void {
        // Research D2: the actor middleware is appended AHEAD of EnsureAccountEnabled, so the
        // 401 a disabled account receives still names the account — exactly the row an
        // operator investigating that account came for. Registration order is group order,
        // so this breaks silently if the two lines in bootstrap/app.php are ever swapped.
        $user = User::factory()->create(['email' => 'ada@example.com']);
        $session = $this->signIn('ada@example.com');
        $user->disabled_at = now();
        $user->save();

        $this->replay($session)->getJson('/api/user')->assertStatus(401);

        $this->assertSame($user->id, $this->entryFor('api/user')->user_id);
    }

    /**
     * Sign in for real and hand back the session cookie the browser would keep.
     */
    private function signIn(string $email): Cookie {
        $login = $this->postJson('/api/login', ['email' => $email, 'password' => 'password']);
        $login->assertOk();

        return $login->getCookie((string) config('session.cookie'), false);
    }

    /**
     * Send the session cookie back the way a browser does. postJson()/getJson() attach no
     * cookies unless withCredentials() is enabled, so without this the "next request" would
     * silently carry nothing and prove nothing.
     */
    private function replay(Cookie $session): static {
        // In production every request boots a fresh container, so the auth manager starts
        // with no resolved guard and reads the account back out of the session store. Here
        // one container serves the whole test, and a guard left resolved by the sign-in
        // would answer from memory — hiding any change made to the account since.
        $this->app['auth']->forgetGuards();

        return $this->withCredentials()->withUnencryptedCookie($session->getName(), $session->getValue());
    }

    private function entryFor(string $path): AccessLog {
        return AccessLog::query()->where('path', $path)->sole();
    }
}
