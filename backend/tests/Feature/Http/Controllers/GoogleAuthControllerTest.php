<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Controllers;

use App\Enums\Role;
use App\Models\Comment;
use App\Models\Trashpost;
use App\Models\User;
use App\Models\UserIdentity;
use App\Support\OAuthFlowState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
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
        // The sign-out ran `auth:sanctum`, whose middleware calls shouldUse() and leaves
        // the TOKEN guard as this process's ambient default — which has neither login()
        // nor attempt(). A real browser never sees that: every request boots its own
        // container with the configured default. Put it back so whatever runs next
        // behaves the way it does in production rather than the way this process left it.
        // Named literally, because shouldUse() OVERWRITES `auth.defaults.guard` — reading
        // the config back would just hand it the value the middleware already put there.
        $this->app['auth']->shouldUse('web');
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

    // ------------------------------------------------- US3: AS1 the address collision

    /**
     * A password account already holding the address the claim carries, with contents
     * and non-default columns so "unchanged" means something.
     */
    private function accountHoldingTheAddress(): User {
        return User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'visitor@example.com',
            'rating' => 7,
        ]);
    }

    public function test_a_google_address_already_on_an_account_signs_into_that_account(): void {
        $this->fakeGoogle();
        $existing = $this->accountHoldingTheAddress();

        $this->completeFlow()->assertRedirect(self::FRONTEND . '/');

        // FR-011: Google confirmed the address, so the account holding it is theirs —
        // one person, one account, and now two ways in.
        $this->assertSame($existing->id, Auth::guard('web')->id());
        $this->assertSame(1, User::count());
        $this->assertSame($existing->id, UserIdentity::sole()->user_id);
    }

    // ------------------------------------------------- US3: AS2 the password survives

    public function test_the_linked_accounts_original_password_still_signs_it_in(): void {
        $this->fakeGoogle();
        $existing = $this->accountHoldingTheAddress();
        $hash = $existing->password;

        $this->completeFlow();
        $this->signOut();
        $response = $this->postJson('/api/login', [
            'email' => 'visitor@example.com',
            'password' => 'password',
        ], ['Origin' => 'http://localhost']);

        // SC-004: linking adds a door, it does not close the one that was already there.
        $response->assertOk()->assertJsonPath('data.email', 'visitor@example.com');
        $this->assertSame($hash, User::sole()->password);
    }

    public function test_the_link_changes_nothing_else_about_the_account(): void {
        $this->fakeGoogle();
        $existing = $this->accountHoldingTheAddress();
        $post = Trashpost::factory()->create(['user_id' => $existing->id]);
        $comment = Comment::factory()->for($post)->create(['user_id' => $existing->id]);

        $this->completeFlow();

        // FR-015, INV-6: the account's role, standing and contents are not part of the
        // linking rule, so the visitor signs in and finds everything where they left it.
        $stored = User::sole();
        $this->assertSame('Ada Lovelace', $stored->name);
        $this->assertSame($existing->hash, $stored->hash);
        $this->assertSame(Role::Member, $stored->role);
        $this->assertSame(7, $stored->rating);
        $this->assertSame($existing->id, $post->fresh()->user_id);
        $this->assertSame($existing->id, $comment->fresh()->user_id);
    }

    // ---------------------------------------------- US3: AS3 recognition is by subject

    public function test_a_later_flow_with_a_changed_address_still_lands_in_the_linked_account(): void {
        Http::fake([
            self::TOKEN_URL => Http::sequence()
                ->push(['id_token' => $this->idToken()])
                ->push(['id_token' => $this->idToken(['email' => 'moved@example.com'])]),
        ]);
        $existing = $this->accountHoldingTheAddress();

        $this->completeFlow();
        $this->signOut();
        $this->completeFlow();

        // FR-009: the link now answers the question, so the collision rule is never
        // re-entered — and the second flow's address, which matches nobody, creates
        // nothing.
        $this->assertSame($existing->id, Auth::guard('web')->id());
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
    }

    // ------------------------------------------ US3: AS4 an unverified account is linked

    public function test_an_unverified_account_is_linked_and_verified_at_once(): void {
        $this->fakeGoogle();
        $existing = User::factory()->unverified()->create(['email' => 'visitor@example.com']);

        $this->completeFlow()->assertRedirect(self::FRONTEND . '/');

        // The confirmation e-mail this account was waiting on asks for exactly the proof
        // Google has just supplied, so waiting for it as well would be theatre.
        $this->assertNotNull(User::sole()->email_verified_at);
        $this->assertSame($existing->id, UserIdentity::sole()->user_id);
    }

    // ----------------------------------------- US3: AS5 an unconfirmed address is refused

    public function test_an_unconfirmed_address_never_reaches_the_account_holding_it(): void {
        $this->fakeGoogle(['email_verified' => false]);
        $existing = $this->accountHoldingTheAddress();

        $response = $this->completeFlow();

        // FR-005 is the guard the whole auto-link stands on: without it anyone could
        // claim a stranger's address at an identity provider and inherit their account.
        $response->assertRedirect(self::FRONTEND . '/login?error=unverified_email');
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertSame(0, UserIdentity::count());
        $this->assertNull($existing->fresh()->googleIdentity);
    }

    // ------------------------------------------ US3: AS6 one account, one Google account

    public function test_a_second_google_account_on_one_address_is_refused(): void {
        $this->fakeGoogle(['sub' => 'a-second-subject']);
        $existing = $this->accountHoldingTheAddress();
        $original = UserIdentity::factory()->for($existing)->create(['provider_user_id' => 'the-first-subject']);

        $response = $this->completeFlow();

        // FR-012: re-pointing the link would hand whoever arrived second the keys to
        // somebody else's account, so the refusal comes before any write.
        $response->assertRedirect(self::FRONTEND . '/login?error=already_linked');
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertSame(1, UserIdentity::count());
        $stored = UserIdentity::sole();
        $this->assertSame($original->id, $stored->id);
        $this->assertSame('the-first-subject', $stored->provider_user_id);
    }

    // ------------------------------------------------- US5: AS1 the disabled account

    /** A Google-linked account whose access an administrator has revoked. */
    private function disabledLinkedAccount(): User {
        $user = User::factory()->googleOnly()->disabled()->create(['email' => 'visitor@example.com']);
        UserIdentity::factory()->for($user)->create(['provider_user_id' => self::SUB]);

        return $user;
    }

    public function test_a_disabled_linked_account_is_refused_at_the_google_door(): void {
        $this->fakeGoogle();
        $existing = $this->disabledLinkedAccount();

        $response = $this->completeFlow();

        // FR-017, US5 AS1: the same refusal the password door gives, because a door the
        // administrator did not close is not access revocation.
        $response->assertRedirect(self::FRONTEND . '/login?error=disabled');
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertTrue($existing->disabled_at->equalTo($existing->fresh()->disabled_at));
    }

    // --------------------------------------------- US5: AS2 Google confers no role

    public function test_a_google_session_gets_the_role_the_account_already_held(): void {
        $this->fakeGoogle();
        User::factory()->admin()->create(['email' => 'visitor@example.com']);

        $this->completeFlow();

        // FR-018: the account's own role decides, both ways. A member signing in with
        // Google is refused the console (asserted above) and an admin is not — the door
        // the session came through is not part of the question.
        $this->getJson('/api/admin/users')->assertOk();
    }

    // ------------------------------------------ US5: AS3 the account deleted mid-flow

    public function test_an_account_hard_deleted_mid_flow_leaves_a_new_visitor(): void {
        $this->fakeGoogle();
        $gone = $this->disabledLinkedAccount()->fresh();
        $gone->forceFill(['disabled_at' => null])->save();

        $state = $this->startFlow();
        // Feature 013's hard delete, run while the visitor is away at Google's consent
        // screen. The link cascades with the account (FR-032).
        $gone->delete();
        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);
        $this->app['auth']->forgetGuards();

        // US5 AS3: no error and no missing account to sign into — the same Google
        // account is simply somebody new.
        $response->assertRedirect(self::FRONTEND . '/');
        $this->assertSame(1, User::count());
        $this->assertNotSame($gone->id, User::sole()->id);
        $this->assertSame(User::sole()->id, UserIdentity::sole()->user_id);
    }

    // ------------------------------------- US5: AS4 refused before it is ever linked

    public function test_a_disabled_account_matched_by_address_is_refused_before_linking(): void {
        $this->fakeGoogle();
        $existing = $this->accountHoldingTheAddress();
        $existing->forceFill(['disabled_at' => now()])->save();
        $existing->refresh();

        $response = $this->completeFlow();

        // US5 AS4, SC-006: the refusal precedes the first write, so the account is left
        // exactly as the administrator left it — not linked and then refused.
        $response->assertRedirect(self::FRONTEND . '/login?error=disabled');
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertSame(0, UserIdentity::count());
        $stored = User::sole();
        $this->assertSame($existing->password, $stored->password);
        $this->assertSame(7, $stored->rating);
        $this->assertTrue($existing->disabled_at->equalTo($stored->disabled_at));
        $this->assertTrue($existing->updated_at->equalTo($stored->updated_at));
    }

    // ---------------------------------------------------- US5: AS5 re-enabled again

    public function test_a_re_enabled_account_signs_in_through_google_normally(): void {
        Http::fake([self::TOKEN_URL => Http::sequence()
            ->push(['id_token' => $this->idToken()])
            ->push(['id_token' => $this->idToken()])]);
        $existing = $this->accountHoldingTheAddress();
        $existing->forceFill(['disabled_at' => now()])->save();

        $this->completeFlow()->assertRedirect(self::FRONTEND . '/login?error=disabled');
        $existing->forceFill(['disabled_at' => null])->save();
        $response = $this->completeFlow();

        // FR-017's final clause: re-enabling is the whole of the undo, because the
        // refusal left no half-built link behind to clear first.
        $response->assertRedirect(self::FRONTEND . '/');
        $this->assertSame($existing->id, Auth::guard('web')->id());
        $this->assertSame($existing->id, UserIdentity::sole()->user_id);
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

    // ------------------------------------------- US4: the flow does not complete
    //
    // Every case below asserts the same three things, because SC-005 is a conjunction:
    // a real page (the 302 and its message code), signed out, and nothing written.
    // None of them fakes the token endpoint — Http::preventStrayRequests() is armed in
    // setUp(), so a refusal that let a request through to Google would fail the test
    // outright rather than pass quietly.
    //
    // The controller shape these cover already existed, so every test here was green the
    // moment it was written and none of them proved anything by passing. Each was checked
    // by deleting the guard it claims to exercise and confirming it goes red: the provider
    // -error branch, the state comparison, the TTL check, the `code` guard, and consume()'s
    // pull-not-get. Two of them — an absent state and a callback with no flow at all — turn
    // out to be refused by TWO independent guards (a non-string state, and an absent
    // `expires_at` reading as 0), so removing either alone leaves them green; they go red
    // only when both are gone. That redundancy is the design, not a gap, and it is recorded
    // here so nobody later reads a single-guard mutation surviving as proof the test is
    // vacuous.

    /** The 302, the message code, no session, and no rows: the whole of SC-005 at once. */
    private function assertRefusedWithoutWriting(TestResponse $response, string $code): void {
        $response->assertRedirect(self::FRONTEND . '/login?error=' . $code);
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertSame(0, User::count());
        $this->assertSame(0, UserIdentity::count());
    }

    // ---------------------------------------------------------- US4: AS1 cancellation

    public function test_a_declined_consent_screen_is_reported_as_a_cancellation(): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?error=access_denied&state=' . $state);

        // Choosing not to continue is not a fault, and the visitor already knows what
        // they did — so this is the one refusal whose sentence offers to try again
        // rather than apologising for something.
        $this->assertRefusedWithoutWriting($response, 'cancelled');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function providerErrors(): array {
        return [
            'a Google-side fault' => ['server_error'],
            'a temporary outage' => ['temporarily_unavailable'],
            'a scope Google refused' => ['invalid_scope'],
            'a client the console does not know' => ['invalid_client'],
        ];
    }

    #[DataProvider('providerErrors')]
    public function test_any_other_provider_error_is_not_blamed_on_the_visitor(string $error): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?error=' . urlencode($error) . '&state=' . $state);

        // Only `access_denied` is a decision the visitor made. Everything else is the
        // provider's problem, and there is nothing for the visitor to correct beyond
        // trying again.
        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    public function test_an_empty_error_value_is_not_treated_as_an_error(): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?error=&state=' . $state);

        // Framework behaviour a refusal path rests on, so it is asserted rather than
        // assumed (research D6): Laravel's GLOBAL ConvertEmptyStringsToNull turns `?error=`
        // into an absent parameter, so this request carries no provider error and is judged
        // on its state and code like any other — and having no code, it is the ordinary
        // state refusal. `provider` would be the wrong sentence here anyway: nothing went
        // wrong at Google. What SC-005 asks of this URL either way is that it is a 302 to a
        // real page with nothing written, and it is.
        $this->assertRefusedWithoutWriting($response, 'state');
    }

    // ------------------------------------------------------- US4: AS2 a tampered state

    public function test_an_absent_state_is_refused(): void {
        $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code');

        $this->assertRefusedWithoutWriting($response, 'state');
    }

    public function test_an_altered_state_is_refused(): void {
        $state = $this->startFlow();

        // One character of 64. hash_equals() has no notion of "close enough", which is
        // the point: the state is a token, not a checksum.
        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . strtr($state, ['a' => 'b']));

        $this->assertRefusedWithoutWriting($response, 'state');
    }

    public function test_a_state_from_a_different_flow_is_refused(): void {
        $abandoned = $this->startFlow();
        // A second start replaces the first flow in this browser, so the state above is
        // now exactly what a state minted for somebody ELSE looks like from here: real,
        // well-formed, 64 hex characters, and not the one this session is waiting on.
        $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $abandoned);

        $this->assertRefusedWithoutWriting($response, 'state');
    }

    public function test_a_callback_with_no_flow_at_all_is_refused(): void {
        // Nobody started anything: the URL was typed, bookmarked, or crafted.
        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . str_repeat('a', 64));

        $this->assertRefusedWithoutWriting($response, 'state');
    }

    // ------------------------------------------------ US4: AS3 stale and replayed state

    /** Age the stored flow past its TTL, persisted the way a real request would leave it. */
    private function expireTheFlow(): void {
        $flow = session(OAuthFlowState::SESSION_KEY);
        $flow['expires_at'] = time() - 1;
        session()->put(OAuthFlowState::SESSION_KEY, $flow);
        // Written through to the handler, not just to this process's copy: the next
        // request reloads the session from the driver, and array_replace() lets the
        // STORED value win — so an unsaved change would be silently undone.
        session()->save();
    }

    public function test_a_flow_left_open_past_its_ttl_is_refused(): void {
        $state = $this->startFlow();
        $this->expireTheFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        // The state is the right one; only the clock is wrong. A consent screen left open
        // for hours is a window an attacker can work in, so the TTL is not advisory.
        $this->assertRefusedWithoutWriting($response, 'state');
    }

    public function test_a_state_already_spent_on_a_failed_return_cannot_be_reused(): void {
        $state = $this->startFlow();
        // Consumed by a return trip that ended in a refusal rather than a sign-in.
        $this->get('/api/auth/google/callback?error=access_denied&state=' . $state)
            ->assertRedirect(self::FRONTEND . '/login?error=cancelled');

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        // consume() runs at the TOP of the callback, before any refusal can return, so
        // the state is spent however the request ended. Retrying the abandoned URL after
        // cancelling therefore starts nothing — the visitor has to start a fresh flow.
        $this->assertRefusedWithoutWriting($response, 'state');
    }

    // ------------------------------------------------------- US4: AS2 an absent code

    public function test_an_absent_code_is_refused_as_a_state_failure(): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?state=' . $state);

        // Reported as `state` rather than a code of its own: a return trip missing the
        // code is indistinguishable from a tampered one, and naming the difference would
        // tell an attacker which half of the guard they beat (research D10).
        $this->assertRefusedWithoutWriting($response, 'state');
    }

    public function test_an_empty_code_is_refused_as_a_state_failure(): void {
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=&state=' . $state);

        // Two guards agree here, which is why both are worth having: the framework's
        // ConvertEmptyStringsToNull makes this absent before the controller sees it, and
        // code() refuses `''` on its own account for the day that middleware is not in
        // front of this route.
        $this->assertRefusedWithoutWriting($response, 'state');
    }

    // ------------------------------------------------------ US4: AS4 the provider fails
    //
    // Google refusing, hanging, or answering with nonsense is not something the visitor
    // can act on, so all of it collapses into the one retryable `provider` sentence. What
    // matters here is that a provider outage produces a PAGE and never a partial account:
    // the token exchange is the last thing that happens before the first write, so every
    // one of these lands with the database still empty.

    public function test_a_refused_token_exchange_is_a_provider_failure(): void {
        Http::fake([self::TOKEN_URL => Http::response('{"error":"invalid_grant"}', 400)]);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    public function test_a_token_endpoint_fault_is_a_provider_failure(): void {
        Http::fake([self::TOKEN_URL => Http::response('upstream is unwell', 500)]);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    public function test_a_usable_id_token_on_an_error_status_is_still_refused(): void {
        // The only case that tells the status check apart from the id_token check: a
        // response that FAILED but carries a token that would otherwise be accepted. Both
        // of the cases above are refused either way — a 400 or 500 body has no `id_token`
        // in it, so the missing-token guard catches them and the status check is never the
        // reason. This one isolates it, and without `->successful()` it signs the visitor
        // in on the strength of a body Google never meant as an answer.
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => $this->idToken()], 500)]);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    public function test_an_unreachable_token_endpoint_is_a_provider_failure(): void {
        // A real rejected connection, not a stubbed status: this is the path the 10-second
        // timeout ends on, and it is the one that must not become an uncaught exception —
        // an unreachable Google would otherwise be a 500 in the visitor's face.
        Http::fake([self::TOKEN_URL => Http::failedConnection()]);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    /**
     * @return array<string, array{array<string, mixed>}>
     */
    public static function uselessTokenResponses(): array {
        return [
            'no id_token at all' => [['access_token' => 'ya29.a0-not-what-we-asked-for']],
            // Refused twice over: the guard rejects `''`, and Jwt refuses a token with no
            // three segments even if it did not. Kept for the shape, not for the coverage.
            'an empty id_token' => [['id_token' => '']],
            'an id_token that is not a string' => [['id_token' => ['nested']]],
            'an empty body' => [[]],
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    #[DataProvider('uselessTokenResponses')]
    public function test_a_response_without_a_usable_id_token_is_a_provider_failure(array $body): void {
        // A 200 is not enough: only `id_token` is read, so a response that omits it is as
        // useless as a 500 — including the shapes that would be a TypeError if they were
        // passed along instead of refused.
        Http::fake([self::TOKEN_URL => Http::response($body)]);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    /**
     * @return array<string, array{array<string, mixed>}>
     */
    public static function untrustworthyTokens(): array {
        return [
            'a token minted for another client' => [['aud' => 'someone-elses-client.apps.googleusercontent.com']],
            'a token from another issuer' => [['iss' => 'https://accounts.example.com']],
            'a token that has already expired' => [['exp' => time() - 1]],
            'a token with no expiry at all' => [['exp' => null]],
        ];
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    #[DataProvider('untrustworthyTokens')]
    public function test_an_id_token_failing_its_own_checks_is_a_provider_failure(array $claims): void {
        $this->fakeGoogle($claims);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        // FR-004 end to end. The signature is deliberately not verified (research D5), so
        // `aud`, `iss` and `exp` carry the whole weight: a token for another client, from
        // another issuer, or past its expiry must not create an account here even though
        // it arrived over our own TLS connection.
        $this->assertRefusedWithoutWriting($response, 'provider');
    }

    // --------------------------------------------- US4: a well-formed token, bad claims

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function unusableClaims(): array {
        return [
            'no subject' => [['sub' => null], 'provider'],
            'an empty subject' => [['sub' => ''], 'provider'],
            'a subject wider than the column' => [['sub' => str_repeat('9', 256)], 'provider'],
            'an address that is not an address' => [['email' => 'not-an-address'], 'provider'],
            'an address wider than the column' => [['email' => str_repeat('a', 250) . '@example.com'], 'provider'],
            // Not `provider`: an account with no address at Google is something the visitor
            // CAN act on — sign in with an e-mail and password instead — so it gets the
            // sentence that says so. The two refusals are deliberately different.
            'no address at all' => [['email' => null], 'unverified_email'],
        ];
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    #[DataProvider('unusableClaims')]
    public function test_claims_that_cannot_make_an_account_are_refused_as_a_page(array $claims, string $code): void {
        $this->fakeGoogle($claims);
        $state = $this->startFlow();

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . $state);

        // GoogleIdentity is total by construction, which means it REFUSES rather than
        // returns for any of these. Asserted here at the controller as well as in its own
        // unit suite, because "every exit is a 302" (FR-007, SC-005) is a claim about this
        // route: a constructor throwing anything but OAuthFailure would be a 500, and a
        // 500 mid-sign-in is the blank page the requirement exists to forbid.
        $this->assertRefusedWithoutWriting($response, $code);
    }

    // ------------------------------------- US4: AS4 the password door stays open anyway

    public function test_the_password_door_still_works_while_google_is_down(): void {
        Http::fake([self::TOKEN_URL => Http::response('upstream is unwell', 500)]);
        User::factory()->create(['email' => 'ada@example.com']);
        $state = $this->startFlow();

        $this->get('/api/auth/google/callback?code=the-code&state=' . $state)
            ->assertRedirect(self::FRONTEND . '/login?error=provider');
        $response = $this->postJson('/api/login', [
            'email' => 'ada@example.com',
            'password' => 'password',
        ], ['Origin' => 'http://localhost']);

        // FR-007: Google is an ADDITIONAL door, so an outage behind it must not shut the
        // one that was always there. This is also why the refusal lands on /login rather
        // than a dead end — the page the visitor is sent to is the page that still works.
        $response->assertOk()->assertJsonPath('data.email', 'ada@example.com');
    }

    // ------------------------------------------------------------ US4: the rate limiter
    //
    // The cap is lowered to two per test rather than spending five requests reaching the
    // real one. That also proves the limit is read from config rather than hard-coded,
    // which the e2e stack depends on (it raises the cap for its own run).

    /**
     * The limiter bucket both routes share. Spelled out rather than read from the
     * controller's private const: a test that imported the key from the code under test
     * would still pass if the key changed, which is the one thing it must not do — the
     * whole point is that the two doors agree on ONE bucket.
     */
    private const LIMIT_KEY = 'google-oauth:127.0.0.1';

    private function capTheLimiterAtTwo(): void {
        config()->set('app.auth_throttle', 2);
    }

    public function test_the_start_route_refuses_a_flood_with_a_page_and_not_a_429(): void {
        $this->capTheLimiterAtTwo();
        $this->get('/api/auth/google/redirect')->assertRedirectContains(self::AUTHORIZE_URL);
        $this->get('/api/auth/google/redirect')->assertRedirectContains(self::AUTHORIZE_URL);

        $response = $this->get('/api/auth/google/redirect');

        // Research D11, FR-007: the check lives in the controller precisely so this is a
        // 302 to a real page. The `throttle:` middleware would answer Laravel's HTML 429
        // here, which is a dead end in the middle of a sign-in — asserting the status is
        // 302 is what pins that choice.
        $response->assertStatus(302);
        $response->assertRedirect(self::FRONTEND . '/login?error=rate_limited');
    }

    public function test_the_callback_refuses_a_flood_with_a_page_and_not_a_429(): void {
        $this->capTheLimiterAtTwo();
        // A state nobody minted, so each of these is an ordinary refusal that spends a
        // slot without ever reaching Google — which is the shape a flood actually has.
        $bogus = '/api/auth/google/callback?code=the-code&state=' . str_repeat('a', 64);
        $this->get($bogus)->assertRedirect(self::FRONTEND . '/login?error=state');
        $this->get($bogus)->assertRedirect(self::FRONTEND . '/login?error=state');

        $response = $this->get($bogus);

        // The same URL that answered `state` twice now answers `rate_limited`, because the
        // limiter is checked before anything on the URL is read. The cap is on the door,
        // not on the outcome — otherwise the cheapest requests would be uncapped.
        $response->assertStatus(302);
        $this->assertRefusedWithoutWriting($response, 'rate_limited');
    }

    public function test_both_doors_draw_on_one_shared_budget(): void {
        $this->capTheLimiterAtTwo();
        $this->get('/api/auth/google/redirect')->assertRedirectContains(self::AUTHORIZE_URL);
        $this->get('/api/auth/google/redirect')->assertRedirectContains(self::AUTHORIZE_URL);

        $response = $this->get('/api/auth/google/callback?code=the-code&state=' . str_repeat('a', 64));

        // One bucket, not one per route: a flood that could be split across two doors
        // would get twice the budget for the same effort, which is not a cap.
        $this->assertRefusedWithoutWriting($response, 'rate_limited');
    }

    public function test_an_already_signed_in_visitors_stray_clicks_cost_nobody_their_budget(): void {
        $this->capTheLimiterAtTwo();
        $this->actingAs(User::factory()->create());
        for ($i = 0; $i < 4; $i++) {
            $this->get('/api/auth/google/redirect')->assertRedirect(self::FRONTEND . '/');
        }

        // Four clicks, twice the cap, and the bucket was never touched at all. Asserted
        // BEFORE the request below, which spends a slot of its own — checking afterwards
        // would be asserting 1 and proving nothing.
        $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
        // Anonymous again, from the same IP — a shared office, a NAT, a phone network.
        $this->app['auth']->forgetGuards();
        $this->app['auth']->shouldUse('web');

        // The authenticated check runs BEFORE the limiter, which is the whole reason that
        // ordering is load-bearing: a signed-in visitor whose SPA re-renders the button
        // must not be able to lock their colleagues out of signing in.
        $this->get('/api/auth/google/redirect')->assertRedirectContains(self::AUTHORIZE_URL);
    }

    public function test_a_refused_request_does_not_deepen_its_own_hole(): void {
        $this->capTheLimiterAtTwo();
        $this->get('/api/auth/google/redirect');
        $this->get('/api/auth/google/redirect');
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));

        for ($i = 0; $i < 5; $i++) {
            $this->get('/api/auth/google/redirect')->assertRedirect(self::FRONTEND . '/login?error=rate_limited');
        }

        // hit() runs only after the check passes, so hammering the door while locked out
        // does not extend the lockout. Otherwise a visitor whose SPA retries — or who just
        // keeps clicking — could never wait their way out of a window they never left.
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));
    }

    // ------------------------------------------------- US4: AS5 the replayed callback
    //
    // The two callbacks above the fold both failed, so neither could have written twice.
    // These two start from a callback that SUCCEEDED, which is the only version of the
    // question worth asking: once a code has already bought an account and a session,
    // what does presenting it a second time buy?

    public function test_a_replayed_callback_creates_no_second_account_and_no_second_session(): void {
        $this->fakeGoogle();
        $state = $this->startFlow();
        $url = '/api/auth/google/callback?code=the-code&state=' . $state;
        $this->get($url)->assertRedirect(self::FRONTEND . '/');
        $signedIn = User::sole()->id;
        $this->app['auth']->forgetGuards();

        $response = $this->get($url);

        // Nothing here relies on Google rejecting a re-used code, which it does: the state
        // is already spent, so the second request is refused before the code is presented
        // at all. Http::assertSentCount(1) is what proves that — the token endpoint was
        // never asked a second time, so the guarantee is ours and not the provider's.
        $response->assertRedirect(self::FRONTEND . '/login?error=state');
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
        $this->assertSame($signedIn, Auth::guard('web')->id());
        Http::assertSentCount(1);
    }

    public function test_a_callback_url_replayed_from_another_browser_signs_nobody_in(): void {
        $this->fakeGoogle();
        $state = $this->startFlow();
        $url = '/api/auth/google/callback?code=the-code&state=' . $state;
        $this->get($url)->assertRedirect(self::FRONTEND . '/');
        $this->app['auth']->forgetGuards();
        // A session with nothing in it: no flow, no signed-in account. That is what the
        // attacker's browser has when a callback URL is lifted from a server log, a
        // Referer header, or a shoulder-surfed address bar. Written through to the driver,
        // because the next request reloads the session and the STORED value wins.
        session()->flush();
        session()->save();

        $response = $this->get($url);

        // FR-003's "bound to the browser that started it", which is the property a signed
        // self-describing token would NOT have given us: unguessable and single-use, yes,
        // but redeemable from anywhere. Holding the whole URL is not enough here.
        $response->assertRedirect(self::FRONTEND . '/login?error=state');
        $this->assertFalse(Auth::guard('web')->check());
        $this->assertSame(1, User::count());
        $this->assertSame(1, UserIdentity::count());
        Http::assertSentCount(1);
    }
}
