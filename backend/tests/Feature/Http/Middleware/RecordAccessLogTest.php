<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use App\Models\AccessLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;
use RuntimeException;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

/**
 * The recorder is PREPENDED to the global stack — the outermost frame — so it observes
 * every request the application handles, including the ones a guard rejected and the ones
 * that ended in an unhandled exception (research D1). It records in its after-phase, before
 * the response leaves the pipeline (FR-001a), and returns that response untouched (FR-026).
 */
final class RecordAccessLogTest extends TestCase {
    use RefreshDatabase;

    /** Spelled out rather than read from the redactor, so a change fails a test. */
    private const REDACTED = '[redacted]';

    protected function setUp(): void {
        parent::setUp();
        $this->defineProbes();
    }

    public function test_a_request_produces_exactly_one_entry_carrying_the_shape_of_the_exchange(): void {
        $this->get('/api/_probe/ok')->assertOk();

        // sole() is the "exactly once" assertion: it throws on zero rows and on two.
        $entry = $this->entryFor('api/_probe/ok');
        $this->assertSame('GET', $entry->method);
        $this->assertSame(200, $entry->status);
        $this->assertSame('127.0.0.1', $entry->remote_addr);
        $this->assertNotNull($entry->created_at);
        $this->assertGreaterThan(0, $entry->duration_us);
        $this->assertSame(strlen('probe body'), $entry->response_bytes);
    }

    public function test_a_redirect_is_recorded_with_the_status_the_visitor_received(): void {
        $this->get('/api/_probe/redirect')->assertStatus(302);

        $this->assertSame(302, $this->entryFor('api/_probe/redirect')->status);
    }

    public function test_a_request_for_a_path_that_does_not_exist_is_recorded(): void {
        $this->getJson('/api/_probe/nothing-here')->assertStatus(404);

        $this->assertSame(404, $this->entryFor('api/_probe/nothing-here')->status);
    }

    public function test_an_unhandled_exception_is_recorded_as_the_rendered_server_error(): void {
        // Illuminate\Routing\Pipeline renders a thrown Throwable into a response WHILE
        // unwinding, so the outermost after-phase receives the real 500 rather than the
        // exception (research D1). This is why recording on the way out needs no
        // try/finally around $next.
        $this->getJson('/api/_probe/boom')->assertStatus(500);

        $this->assertSame(500, $this->entryFor('api/_probe/boom')->status);
    }

    public function test_a_request_a_guard_rejected_is_still_recorded(): void {
        // FR-001: route and group middleware run INSIDE the global stack, so an outermost
        // frame sees their rejections. A recorder appended to the api group would not.
        $this->getJson('/api/_probe/guarded')->assertStatus(401);

        $this->assertSame(401, $this->entryFor('api/_probe/guarded')->status);
    }

    public function test_a_forged_forwarded_header_never_displaces_the_observed_peer(): void {
        // FR-002a: this repo sets trustProxies(at: '*'), which makes $request->ip() return
        // the FORWARDED address — precisely the wrong call here. remote_addr comes off the
        // connection (REMOTE_ADDR) and the header is kept beside it as an unverified claim.
        $this->get('/api/_probe/ok', ['X-Forwarded-For' => '203.0.113.9'])->assertOk();

        $entry = $this->entryFor('api/_probe/ok');
        $this->assertSame('203.0.113.9', $entry->forwarded_for);
        $this->assertSame('127.0.0.1', $entry->remote_addr);
    }

    public function test_a_request_without_the_forwarded_header_records_an_empty_claim(): void {
        $this->get('/api/_probe/ok')->assertOk();

        $this->assertSame('', $this->entryFor('api/_probe/ok')->forwarded_for);
    }

    public function test_a_multi_hop_forwarded_chain_is_kept_whole(): void {
        $this->get('/api/_probe/ok', ['X-Forwarded-For' => '203.0.113.9, 198.51.100.7'])->assertOk();

        $this->assertSame('203.0.113.9, 198.51.100.7', $this->entryFor('api/_probe/ok')->forwarded_for);
    }

    public function test_the_submitted_parameters_cookies_and_files_are_recorded(): void {
        $this->withCredentials()
            ->withUnencryptedCookie('taste', 'vanilla')
            ->post('/api/_probe/ok?page=2', [
                'title' => 'meme',
                'image' => UploadedFile::fake()->create('meme.gif', 1),
            ])->assertOk();

        $entry = $this->entryFor('api/_probe/ok');
        $this->assertSame(['page' => '2'], $entry->query);
        $this->assertSame(['title' => 'meme'], $entry->input);
        $this->assertSame('vanilla', $entry->cookies['taste']);
        $this->assertSame('image', $entry->files[0]['field']);
        $this->assertSame('meme.gif', $entry->files[0]['name']);
        $this->assertSame(1024, $entry->files[0]['size']);
        // FR-017: the description, never the bytes.
        $this->assertArrayNotHasKey('content', $entry->files[0]);
        // FR-005a: a raw body beside the parsed map would defeat US2 (research D5).
        $this->assertNull($entry->body);
    }

    public function test_the_user_agent_and_referer_are_recorded(): void {
        $this->get('/api/_probe/ok', [
            'User-Agent' => 'ladybug-test/1.0',
            'Referer' => 'http://ladybug.test/feed',
        ])->assertOk();

        $entry = $this->entryFor('api/_probe/ok');
        $this->assertSame('ladybug-test/1.0', $entry->user_agent);
        $this->assertSame('http://ladybug.test/feed', $entry->referer);
    }

    public function test_a_response_with_no_content_string_records_no_size(): void {
        // A streamed response has nothing to measure and may carry no Content-Length. NULL
        // means "not measurable", which is honest where 0 would be a lie — and the callback
        // must never be invoked to find out, which is what the throw below enforces.
        $this->get('/api/_probe/stream')->assertOk();

        $this->assertNull($this->entryFor('api/_probe/stream')->response_bytes);
    }

    public function test_recording_leaves_the_visitors_response_untouched(): void {
        // FR-026/SC-009: nothing about the history reaches the visitor. The stronger form of
        // this — byte-identical to a run with the feature absent — is asserted in US3, where
        // the switch that makes the comparison possible exists.
        $response = $this->get('/api/_probe/ok');

        $response->assertOk();
        $this->assertSame('probe body', $response->getContent());
        foreach ($response->headers->all() as $name => $values) {
            $this->assertStringNotContainsString('access-log', strtolower($name));
            $this->assertStringNotContainsString('access_log', strtolower($name));
        }
        $this->assertNotNull($this->entryFor('api/_probe/ok'));
    }

    public function test_a_body_refused_for_its_size_is_still_recorded_with_nothing_parsed(): void {
        // SC-005b. ValidatePostSize sits INSIDE the prepended recorder (research D1), so its
        // rejection is recorded like any other outcome. PHP discarded the body before
        // anything could parse it, so input and files are empty — the correct answer, not a
        // gap. If this row is missing, the middleware is registered in the wrong place.
        $response = $this->call('POST', '/api/_probe/ok', [], [], [], ['CONTENT_LENGTH' => '999999999999']);

        $response->assertStatus(413);
        $entry = $this->entryFor('api/_probe/ok');
        $this->assertSame(413, $entry->status);
        $this->assertSame('POST', $entry->method);
        $this->assertNull($entry->input);
        $this->assertNull($entry->files);
    }

    // --- Secrets never come to rest (US2, FR-013-FR-016, SC-003) -----------------------

    public function test_a_real_sign_in_keeps_the_address_and_withholds_the_password(): void {
        // The unit tests prove the redactor withholds a name; this proves the recorder
        // actually routes a real request's parameters through it. FR-016 keeps the address,
        // which is what identifies the actor on a row FR-008b deliberately leaves unnamed.
        User::factory()->create(['email' => 'ada@example.com']);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password'])
            ->assertOk();

        $entry = $this->entryFor('api/login');
        $this->assertSame('ada@example.com', $entry->input['email']);
        $this->assertSame(self::REDACTED, $entry->input['password']);
    }

    public function test_a_sign_in_stores_no_raw_body_beside_the_redacted_map(): void {
        // FR-005a / research D5: the raw body of this request is literally
        // {"email":"…","password":"password"}, and name-based redaction cannot reach inside
        // an opaque string. Storing it would defeat the whole of US2 in one column.
        User::factory()->create(['email' => 'ada@example.com']);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => 'ada@example.com', 'password' => 'password'])
            ->assertOk();

        $this->assertNull($this->entryFor('api/login')->body);
    }

    public function test_the_cookies_a_signed_in_browser_carries_are_withheld(): void {
        // The session id is the one value in the whole exchange that would let anyone with
        // read access to this table impersonate the visitor — the scenario US2 opens with,
        // and what SC-003's second search looks for.
        User::factory()->create(['email' => 'ada@example.com']);
        $session = $this->signIn('ada@example.com');

        // withCookie, not withUnencryptedCookie: the api group runs EncryptCookies, so these
        // arrive encrypted and are decrypted IN PLACE before the recorder's after-phase sees
        // them — which is the point. By the time the row is built, a real browser's session
        // cookie is sitting in that bag in plaintext.
        $this->replay($session)
            ->withCookie('XSRF-TOKEN', 'the csrf token')
            ->withCookie((string) config('remember.cookie'), '1')
            ->withCookie('taste', 'vanilla')
            ->getJson('/api/user')->assertOk();

        $cookies = $this->entryFor('api/user')->cookies;
        $this->assertSame(self::REDACTED, $cookies[(string) config('session.cookie')]);
        $this->assertSame(self::REDACTED, $cookies['XSRF-TOKEN']);
        $this->assertSame(self::REDACTED, $cookies[(string) config('remember.cookie')]);
        // FR-016: everything else is kept, or the history stops being diagnostic.
        $this->assertSame('vanilla', $cookies['taste']);
    }

    public function test_a_signed_links_signature_is_withheld_while_the_link_stays_legible(): void {
        // 008's verification links carry their signature in the QUERY STRING, which is
        // recorded like any other map — so a one-time credential would come to rest there
        // unless `signature` is on the list (US2 scenario 3).
        $user = User::factory()->unverified()->create(['email' => 'ada@example.com']);
        $hash = sha1($user->email);
        $url = URL::temporarySignedRoute('verification.verify', now()->addDay(), ['hash' => $hash], absolute: false);

        $this->withHeader('Origin', 'http://localhost')->getJson($url);

        $query = $this->entryFor("api/email/verify/{$hash}")->query;
        $this->assertSame(self::REDACTED, $query['signature']);
        // Not withheld: an operator has to be able to see the link had already expired, and
        // an expiry stamp opens nothing on its own (FR-016).
        $this->assertArrayHasKey('expires', $query);
    }

    // --- The operator's switch and the exclusion list (US3, FR-020-FR-022, SC-004) ------

    public function test_recording_is_on_when_the_switch_was_never_set(): void {
        // US3 scenario 1: a fresh deployment records without anyone remembering to enable
        // it. offsetUnset() is how a missing key actually presents itself to the guard —
        // Laravel's config repository stores null rather than removing the entry, so a
        // guard written as a bare truthiness check would read "absent" as "off".
        config()->offsetUnset('access_log.enabled');

        $this->get('/api/_probe/ok')->assertOk();

        $this->assertSame(200, $this->entryFor('api/_probe/ok')->status);
    }

    public function test_the_switch_off_writes_nothing_and_erases_nothing(): void {
        // FR-021 / US3 scenario 3: off means "stop writing", never "erase". The history an
        // operator switched recording off to stop growing is still the history they had.
        $this->get('/api/_probe/ok')->assertOk();

        config(['access_log.enabled' => false]);
        $this->get('/api/_probe/redirect')->assertStatus(302);

        $this->assertSame(0, AccessLog::query()->where('path', 'api/_probe/redirect')->count());
        $this->assertSame(200, $this->entryFor('api/_probe/ok')->status);
    }

    public function test_the_switch_off_leaves_the_response_byte_identical(): void {
        // SC-004's stronger half, which US1 could not assert because the comparison needs
        // the switch to exist: a recorded response and an unrecorded one are the same
        // response. The middleware stays in the stack and touches neither phase.
        $recorded = $this->get('/api/_probe/ok');

        config(['access_log.enabled' => false]);
        $unrecorded = $this->get('/api/_probe/ok');

        $this->assertSame($recorded->getStatusCode(), $unrecorded->getStatusCode());
        $this->assertSame($recorded->getContent(), $unrecorded->getContent());
        // Date moves by construction and Set-Cookie carries a fresh session id; every other
        // header must match name for name and value for value.
        $this->assertSame(
            $this->comparableHeaders($recorded->headers->all()),
            $this->comparableHeaders($unrecorded->headers->all())
        );
    }

    public function test_an_excluded_path_is_skipped_while_its_neighbour_is_recorded(): void {
        config(['access_log.excluded_paths' => ['api/_probe/ok']]);

        $this->get('/api/_probe/ok')->assertOk();
        $this->get('/api/_probe/redirect')->assertStatus(302);

        $this->assertSame(0, AccessLog::query()->where('path', 'api/_probe/ok')->count());
        $this->assertSame(302, $this->entryFor('api/_probe/redirect')->status);
    }

    public function test_an_exclusion_pattern_matches_laravels_wildcard_form(): void {
        // Matched with $request->is(), so `admin/*` works and patterns carry no leading
        // slash — the form contracts/configuration.md documents to operators.
        config(['access_log.excluded_paths' => ['api/_probe/*']]);

        $this->get('/api/_probe/ok')->assertOk();

        $this->assertSame(0, AccessLog::query()->count());
    }

    public function test_the_health_probes_are_excluded_out_of_the_box(): void {
        // FR-022: container health checks poll these continuously and would otherwise
        // outnumber real traffic. Asserted against the shipped default, not a test-set
        // value, so dropping either name from config/access_log.php fails here.
        $this->getJson('/api/health')->assertOk();
        $this->get('/up')->assertOk();

        $this->assertSame(0, AccessLog::query()->count());
    }

    /** Header map minus the two entries that legitimately differ between two runs. */
    private function comparableHeaders(array $headers): array {
        unset($headers['date'], $headers['set-cookie']);

        return $headers;
    }

    /**
     * Sign in for real and hand back the session cookie the browser would keep. The same
     * shape CaptureAccessLogActorTest uses, and for the same reason: actingAs() would skip
     * the cookies this file is asserting about.
     */
    private function signIn(string $email): Cookie {
        $login = $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/login', ['email' => $email, 'password' => 'password']);
        $login->assertOk();

        return $login->getCookie((string) config('session.cookie'), false);
    }

    /** Send the session cookie back the way a browser does. */
    private function replay(Cookie $session): static {
        $this->app['auth']->forgetGuards();

        return $this->withCredentials()->withUnencryptedCookie($session->getName(), $session->getValue());
    }

    /**
     * The one entry recorded for a path. sole() throws unless there is exactly one, so
     * every caller is also asserting FR-001's "exactly once".
     */
    private function entryFor(string $path): AccessLog {
        return AccessLog::query()->where('path', $path)->sole();
    }

    /**
     * The probes live under /api because routes/web.php ends in the SPA shell catch-all,
     * which claims every address outside `api|up|sanctum|storage` — a route registered from
     * a test is registered LAST and would lose to it.
     */
    private function defineProbes(): void {
        Route::get('/api/_probe/ok', static fn (): string => 'probe body');
        Route::post('/api/_probe/ok', static fn (): string => 'probe body');
        Route::get('/api/_probe/redirect', static fn () => redirect('/api/_probe/ok'));
        Route::get('/api/_probe/boom', static function (): void {
            throw new RuntimeException('deliberate failure, to prove the 500 is recorded');
        });
        Route::get('/api/_probe/stream', static fn () => response()->stream(static function (): void {
            throw new RuntimeException('the recorder must not run a streamed response to measure it');
        }));
        Route::middleware('auth:sanctum')->get('/api/_probe/guarded', static fn (): string => 'never reached');
    }
}
