<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Enums\Role;
use App\Models\Trashpost;
use App\Models\User;
use App\Models\UserIdentity;
use App\Support\OAuthFlowState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The two browser-facing endpoints, driven end to end over a real session: the start
 * route mints the flow, the callback consumes it. Google is never contacted — the token
 * endpoint is faked and the id_token synthesized from three base64url segments
 * (research D16).
 *
 * Neither endpoint ever returns JSON: every exit is a 302 to a real SPA page (FR-007).
 */
final class GoogleAuthControllerTest extends TestCase {
    use RefreshDatabase;

    private const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    private const FRONTEND = 'http://localhost:5173';

    private const SUB = '110169484474386276334';

    protected function setUp(): void {
        parent::setUp();
        config()->set('app.frontend_url', self::FRONTEND);
        config()->set('services.google', [
            'client_id' => self::CLIENT_ID,
            'client_secret' => 'test-client-secret',
            'redirect_uri' => 'http://localhost:8000/api/auth/google/callback',
            'authorize_url' => self::AUTHORIZE_URL,
            'token_url' => self::TOKEN_URL,
        ]);
        Http::preventStrayRequests();
    }

    // ------------------------------------------------------------------- the fixtures

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function fakeGoogle(array $overrides = []): void {
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => $this->idToken($overrides)])]);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function idToken(array $overrides = []): string {
        $claims = array_merge([
            'iss' => 'https://accounts.google.com',
            'aud' => self::CLIENT_ID,
            'exp' => time() + 300,
            'sub' => self::SUB,
            'email' => 'visitor@example.com',
            'email_verified' => true,
            'name' => 'A Visitor',
        ], $overrides);

        return $this->segment('{"alg":"RS256"}')
            . '.' . $this->segment((string) json_encode(array_filter($claims, [$this, 'isPresent'])))
            . '.' . $this->segment('never-inspected');
    }

    public function isPresent(mixed $claim): bool {
        return $claim !== null;
    }

    private function segment(string $raw): string {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /** Start the flow and return the `state` the server minted into this session. */
    private function startFlow(string $query = ''): string {
        $this->get('/api/auth/google/redirect' . $query)->assertRedirect();

        return (string) session(OAuthFlowState::SESSION_KEY)['state'];
    }

    /** The whole round trip over one session, ending on the callback's redirect. */
    private function completeFlow(string $query = ''): TestResponse {
        $state = $this->startFlow($query);
        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        // Drop the resolved guard so anything asserted after this reads the account
        // back out of the SESSION, the way a genuinely separate request would. Without
        // it the test process hands the next request the very User instance the
        // callback just created — still carrying wasRecentlyCreated, which makes
        // UserResource answer 201 where production answers 200.
        $this->app['auth']->forgetGuards();

        return $response;
    }

    /**
     * End the session the way the SPA does, so a second flow starts anonymous. Without
     * the sign-out the start route is the FR-031 no-op and no second flow exists.
     */
    private function signOut(): void {
        // The Origin header is what makes this request stateful, and it is passed per
        // call rather than set on the test case. Sign-out lives on the `api` group, where
        // Sanctum starts a session only for a request whose Origin matches
        // SANCTUM_STATEFUL_DOMAINS — the same research D2 mechanism that is the reason
        // the two Google routes had to go in web.php instead. Every other request in this
        // file is deliberately origin-less, because that is how a browser arrives back
        // from accounts.google.com.
        $this->postJson('/api/logout', [], ['Origin' => 'http://localhost'])->assertOk();
        $this->app['auth']->forgetGuards();
    }

    // ------------------------------------------------------------- the start route

    public function test_the_start_route_redirects_to_google(): void {
        $response = $this->get('/api/auth/google/redirect');

        $response->assertRedirectContains(self::AUTHORIZE_URL);
    }

    public function test_the_start_route_mints_a_flow_into_the_session(): void {
        $this->get('/api/auth/google/redirect');

        $flow = session(OAuthFlowState::SESSION_KEY);
        $this->assertIsArray($flow);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $flow['state']);
        $this->assertSame('/', $flow['redirect']);
    }

    public function test_the_start_route_carries_the_minted_state_to_google(): void {
        $response = $this->get('/api/auth/google/redirect');

        $response->assertRedirectContains('state=' . session(OAuthFlowState::SESSION_KEY)['state']);
    }

    public function test_an_already_signed_in_visitor_is_a_no_op(): void {
        $response = $this->actingAs(User::factory()->create())->get('/api/auth/google/redirect');

        // FR-031: no flow starts, so no link can be attached and which account is
        // signed in cannot be swapped.
        $response->assertRedirect(self::FRONTEND . '/');
        $this->assertNull(session(OAuthFlowState::SESSION_KEY));
    }

    public function test_an_unconfigured_client_refuses_rather_than_hiding_the_button(): void {
        config()->set('services.google.client_id', '');

        $response = $this->get('/api/auth/google/redirect');

        // Research D12: the control renders unconditionally, so an unconfigured
        // deployment must answer with the retryable message rather than a blank page.
        $response->assertRedirect(self::FRONTEND . '/login?error=provider');
        $this->assertNull(session(OAuthFlowState::SESSION_KEY));
    }

    // ------------------------------------------------------------ the redirect guard

    public function test_an_intended_path_survives_the_round_trip(): void {
        $this->fakeGoogle();

        $response = $this->completeFlow('?redirect=/posts/abc');

        // FR-006: a full-page navigation to Google destroys router state, so the path
        // the visitor was headed for has to travel as ?redirect= and come back.
        $response->assertRedirect(self::FRONTEND . '/posts/abc');
    }

    public function test_no_intended_path_lands_on_the_feed(): void {
        $this->fakeGoogle();

        $this->completeFlow()->assertRedirect(self::FRONTEND . '/');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function foreignRedirects(): array {
        return [
            'a protocol-relative host' => ['//evil.com'],
            'an absolute URL' => ['https://evil.com'],
            'a backslash-smuggled host' => ['/\\evil.com'],
            'a scheme with no host' => ['javascript:alert(1)'],
            'a path that is not a path' => ['posts/abc'],
        ];
    }

    #[DataProvider('foreignRedirects')]
    public function test_a_foreign_redirect_silently_becomes_the_feed(string $redirect): void {
        $this->fakeGoogle();

        $response = $this->completeFlow('?redirect=' . urlencode($redirect));

        // Silently, never as an error and never echoed back: there is nothing for the
        // visitor to correct, and refusing the sign-in over it would be worse.
        $response->assertRedirect(self::FRONTEND . '/');
    }

    // ------------------------------------------------ array-shaped query parameters

    public function test_an_array_shaped_redirect_is_a_redirect_and_not_a_crash(): void {
        // PHP's query parser turns ?redirect[]=x into an ARRAY. Every exit from these
        // two routes must be a 302 (FR-007, SC-005), so an unusable shape has to land
        // on the same silent default a foreign path does — never a 500.
        $response = $this->get('/api/auth/google/redirect?redirect[]=/posts/abc');

        $response->assertRedirectContains(self::AUTHORIZE_URL);
        $this->assertSame('/', session(OAuthFlowState::SESSION_KEY)['redirect']);
    }

    public function test_an_array_shaped_state_is_refused_and_not_a_crash(): void {
        $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state[]=x');

        // A state that is not even a string cannot match, so it is the ordinary state
        // refusal — collapsed into the one code like every other way it can fail.
        $response->assertRedirect(self::FRONTEND . '/login?error=state');
    }

    public function test_an_array_shaped_code_is_refused_and_not_a_crash(): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code[]=x&state=' . $state);

        $response->assertRedirect(self::FRONTEND . '/login?error=state');
    }

    public function test_an_array_shaped_provider_error_is_refused_and_not_a_crash(): void {
        $this->startFlow();

        $response = $this->get('/api/auth/google/callback?error[]=access_denied');

        // Not the cancellation sentence: an array is not Google's own `access_denied`,
        // so it is the provider's problem rather than a choice the visitor made.
        $response->assertRedirect(self::FRONTEND . '/login?error=provider');
    }

    // --------------------------------------------------------------- US1: AS1 signed in

    public function test_a_new_visitor_ends_the_flow_signed_in(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        $this->assertTrue(Auth::check());
        $this->assertSame('visitor@example.com', Auth::user()->email);
    }

    public function test_a_new_visitor_creates_exactly_one_account_and_one_link(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
        $this->assertSame(self::SUB, UserIdentity::sole()->provider_user_id);
    }

    // -------------------------------------------------------- US1: AS3 ordinary account

    public function test_the_created_account_has_the_ordinary_defaults(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        $user = User::sole();
        $this->assertSame('A Visitor', $user->name);
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame(Role::Member, $user->role);
        $this->assertSame(0, $user->rating);
        $this->assertNull($user->password);
        $this->assertNull($user->disabled_at);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{10}$/', $user->hash);
    }

    // ------------------------------------------------- US1: AS2 the session is ordinary

    public function test_the_established_session_passes_the_verified_gate(): void {
        $this->fakeGoogle();
        $post = Trashpost::factory()->create();

        $this->completeFlow();
        $response = $this->postJson("/api/posts/{$post->hash}/comments", ['body' => 'Signed in with Google.']);

        // FR-006/FR-018: the session is indistinguishable from a password one — same
        // guard, same cookie, and it clears `verified` because Google confirmed the
        // address at creation.
        $response->assertCreated();
    }

    public function test_the_established_session_answers_the_user_probe(): void {
        $this->fakeGoogle();

        $this->completeFlow();
        $response = $this->getJson('/api/user');

        $response->assertOk()->assertJsonPath('data.email', 'visitor@example.com');
    }

    public function test_the_established_session_is_an_ordinary_member(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        // FR-018: no middleware treats a Google session differently, so a member
        // reaching an admin console is refused exactly as a password member is.
        $this->getJson('/api/admin/users')->assertForbidden();
    }

    // ------------------------------------------------------- US2: AS1 the return visit

    public function test_a_second_flow_signs_the_same_account_in_again(): void {
        $this->fakeGoogle();
        $this->completeFlow();
        $returning = User::sole()->id;

        $this->signOut();
        $this->completeFlow()->assertRedirect(self::FRONTEND . '/');

        // FR-009: the second visit is recognised by the link, so it is a sign-IN and not
        // a second sign-up — one account, one link, however often the flow is run.
        //
        // The guard is named here for the same reason the controller names it: the
        // sign-out above ran `auth:sanctum`, which leaves the token guard as the ambient
        // default, and the session is the `web` guard's.
        $this->assertSame($returning, Auth::guard('web')->id());
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
    }

    // ------------------------------------------------ US2: AS2 a changed Google profile

    public function test_a_changed_name_and_address_still_land_in_the_same_account(): void {
        Http::fake([
            self::TOKEN_URL => Http::sequence()
                ->push(['id_token' => $this->idToken()])
                ->push(['id_token' => $this->idToken(['email' => 'moved@example.com', 'name' => 'A Renamed Visitor'])]),
        ]);
        $this->completeFlow();
        $returning = User::sole()->id;

        $this->signOut();
        $this->completeFlow();

        // SC-003: the `sub` is the identity and the profile claims are not, so renaming
        // the Google account or moving its address changes nothing here. Ladybug's copy
        // of the name and address belongs to the account (spec Assumptions) and is left
        // exactly as it was.
        $this->assertSame($returning, Auth::guard('web')->id());
        $this->assertSame(1, User::count());
        $stored = User::sole();
        $this->assertSame('visitor@example.com', $stored->email);
        $this->assertSame('A Visitor', $stored->name);
    }

    // ------------------------------------------------------- US2: AS3 signing back out

    public function test_a_google_session_is_ended_by_the_ordinary_sign_out(): void {
        $this->fakeGoogle();
        $this->completeFlow();

        $this->signOut();

        // FR-018 again from the other end: nothing about this session is special, so the
        // one sign-out route the SPA already calls ends it.
        $this->assertFalse(Auth::guard('web')->check());
        $this->getJson('/api/user')->assertOk()->assertExactJson(['data' => null]);
    }

    // ------------------------------------------------- US2: AS4 no further provider call

    public function test_the_signed_in_session_needs_no_further_call_to_google(): void {
        $this->fakeGoogle();

        $this->completeFlow();
        $response = $this->getJson('/api/user');

        // The session carries the visitor from here on. No token is stored and none is
        // refreshed, so the provider is contacted once per sign-in and never again —
        // which is why an outage at Google cannot log anybody out.
        $response->assertOk()->assertJsonPath('data.email', 'visitor@example.com');
        Http::assertSentCount(1);
    }

    // ----------------------------------------------------------------- the token call

    public function test_the_callback_redeems_the_code_exactly_once(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        Http::assertSentCount(1);
    }

    public function test_the_callback_consumes_the_flow_state(): void {
        $this->fakeGoogle();

        $this->completeFlow();

        // Single-use by construction: consume() reads and removes in one operation, so
        // a replayed return finds nothing.
        $this->assertNull(session(OAuthFlowState::SESSION_KEY));
    }
}
