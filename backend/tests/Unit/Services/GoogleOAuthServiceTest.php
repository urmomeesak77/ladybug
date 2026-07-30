<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Exceptions\OAuthFailure;
use App\Services\GoogleOAuthService;
use App\Support\OAuthFlowState;
use GuzzleHttp\Promise\PromiseInterface;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The half of the flow that talks to Google and nothing else: it builds the authorize
 * URL, redeems the code server-to-server, and turns the ID token's claims into a
 * GoogleIdentity. It touches no database at all (research D17), which is what lets
 * this file be pure HTTP and IdentityLinkServiceTest be pure database.
 *
 * Google is never contacted: every test runs under Http::fake() with
 * preventStrayRequests(), and the id_token is synthesized as three base64url segments
 * (research D16).
 */
final class GoogleOAuthServiceTest extends TestCase {
    private const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

    private const CLIENT_SECRET = 'test-client-secret';

    private const REDIRECT_URI = 'http://localhost:8000/api/auth/google/callback';

    private const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const SUB = '110169484474386276334';

    /** The Guzzle options the faked token request was sent with. */
    private array $sentOptions = [];

    /** How many times the token endpoint was asked, for the no-retry assertion. */
    private int $exchangeAttempts = 0;

    protected function setUp(): void {
        parent::setUp();
        config()->set('services.google', [
            'client_id' => self::CLIENT_ID,
            'client_secret' => self::CLIENT_SECRET,
            'redirect_uri' => self::REDIRECT_URI,
            'authorize_url' => self::AUTHORIZE_URL,
            'token_url' => self::TOKEN_URL,
        ]);
        // A request that escapes the fake is a test that reached the real internet.
        Http::preventStrayRequests();
    }

    private function service(): GoogleOAuthService {
        return new GoogleOAuthService();
    }

    /**
     * The fake token endpoint, recording the Guzzle options so the timeout can be
     * asserted. Http::fake() only ever invokes a real Closure — an array callable is
     * returned verbatim as the response body — so the caller wraps this, and the
     * recorded state stays a named property rather than a captured variable.
     */
    public function respondWithToken(Request $request, array $options): PromiseInterface {
        $this->sentOptions = $options;

        return Http::response(['id_token' => self::idToken(), 'access_token' => 'ya29.SHOULD-BE-IGNORED']);
    }

    /**
     * A syntactically real ID token: three base64url segments. The signature segment is
     * arbitrary on purpose — research D5 does not verify it.
     *
     * @param  array<string, mixed>  $overrides  claims to replace or (with null) drop
     */
    private static function idToken(array $overrides = []): string {
        $claims = array_merge([
            'iss' => 'https://accounts.google.com',
            'aud' => self::CLIENT_ID,
            'exp' => time() + 300,
            'sub' => self::SUB,
            'email' => 'visitor@example.com',
            'email_verified' => true,
            'name' => 'A Visitor',
        ], $overrides);

        // A null override means "drop this claim entirely", which is how the absent-claim
        // cases below are expressed without a second helper.
        return self::segment('{"alg":"RS256","kid":"abc"}')
            . '.' . self::segment((string) json_encode(array_filter($claims, [self::class, 'isPresent'])))
            . '.' . self::segment('this-signature-is-never-inspected');
    }

    private static function isPresent(mixed $claim): bool {
        return $claim !== null;
    }

    private static function segment(string $raw): string {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    // ---------------------------------------------------------------- authorize URL

    public function test_the_authorize_url_is_built_on_the_configured_endpoint(): void {
        $url = $this->service()->authorizeUrl('the-state', 'the-verifier');

        $this->assertStringStartsWith(self::AUTHORIZE_URL . '?', $url);
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function authorizeParameters(): array {
        return [
            'response type pins the code flow' => ['response_type', 'code'],
            'client id' => ['client_id', self::CLIENT_ID],
            'redirect uri' => ['redirect_uri', self::REDIRECT_URI],
            'the minimum scopes FR-002 permits' => ['scope', 'openid email profile'],
            'state' => ['state', 'the-state'],
            'PKCE method' => ['code_challenge_method', 'S256'],
            'online access issues no refresh token' => ['access_type', 'online'],
            'the account chooser' => ['prompt', 'select_account'],
        ];
    }

    #[DataProvider('authorizeParameters')]
    public function test_the_authorize_url_carries(string $parameter, string $value): void {
        $query = [];
        parse_str((string) parse_url($this->service()->authorizeUrl('the-state', 'the-verifier'), PHP_URL_QUERY), $query);

        $this->assertSame($value, $query[$parameter] ?? null);
    }

    public function test_the_authorize_url_sends_the_challenge_and_never_the_verifier(): void {
        $query = [];
        parse_str((string) parse_url($this->service()->authorizeUrl('the-state', 'the-verifier'), PHP_URL_QUERY), $query);

        // The verifier stays in the session; only its digest travels (research D4).
        $this->assertSame(OAuthFlowState::challenge('the-verifier'), $query['code_challenge']);
        $this->assertStringNotContainsString('the-verifier', $this->service()->authorizeUrl('the-state', 'the-verifier'));
    }

    // ------------------------------------------------------------------- configured

    public function test_the_client_is_configured_when_both_halves_are_present(): void {
        $this->assertTrue($this->service()->isConfigured());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function halfConfigurations(): array {
        return [
            'no client id' => ['client_id'],
            'no client secret' => ['client_secret'],
            'no redirect uri' => ['redirect_uri'],
        ];
    }

    #[DataProvider('halfConfigurations')]
    public function test_the_client_is_unconfigured_when_a_half_is_missing(string $key): void {
        config()->set("services.google.{$key}", null);

        $this->assertFalse($this->service()->isConfigured());
    }

    public function test_an_empty_string_credential_counts_as_unconfigured(): void {
        // The env templates ship these keys EMPTY, so '' is the value the e2e stack
        // actually holds — it must not read as configured (quickstart §5).
        config()->set('services.google.client_id', '');

        $this->assertFalse($this->service()->isConfigured());
    }

    // --------------------------------------------------------------- token exchange

    public function test_the_code_exchange_posts_the_documented_form_fields(): void {
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken()])]);

        $this->service()->identityFromCode('the-code', 'the-verifier');

        Http::assertSent(function (Request $request): bool {
            $this->assertSame(self::TOKEN_URL, $request->url());
            $this->assertSame('POST', $request->method());
            $this->assertTrue($request->isForm());
            $this->assertSame([
                'code' => 'the-code',
                'client_id' => self::CLIENT_ID,
                'client_secret' => self::CLIENT_SECRET,
                'redirect_uri' => self::REDIRECT_URI,
                'grant_type' => 'authorization_code',
                'code_verifier' => 'the-verifier',
            ], $request->data());

            return true;
        });
    }

    public function test_the_code_exchange_is_sent_with_a_ten_second_timeout(): void {
        Http::fake(fn (Request $request, array $options): PromiseInterface => $this->respondWithToken($request, $options));

        $this->service()->identityFromCode('the-code', 'the-verifier');

        // A hung provider must not hold a php-fpm worker open indefinitely.
        $this->assertSame(10, $this->sentOptions['timeout'] ?? null);
    }

    /** A token endpoint that never answers, counting how many times it was asked. */
    public function failTheConnection(): never {
        $this->exchangeAttempts++;

        throw new ConnectionException('cURL error 28: Operation timed out');
    }

    public function test_a_connection_failure_is_not_retried(): void {
        // Google's authorization codes are single-use, so a retry could not succeed —
        // it would only double the time a worker is held.
        Http::fake([self::TOKEN_URL => fn (): never => $this->failTheConnection()]);

        try {
            $this->service()->identityFromCode('the-code', 'the-verifier');
            $this->fail('Expected the connection failure to be refused.');
        }
        catch (OAuthFailure $failure) {
            $this->assertSame(OAuthFailure::PROVIDER, $failure->failureCode);
        }

        // Counted at the stub rather than with assertSentCount(): a stub that throws
        // never reaches Laravel's recorder, so the recorded list would be empty here
        // whether the service tried once or ten times.
        $this->assertSame(1, $this->exchangeAttempts);
    }

    public function test_only_the_id_token_is_read_from_the_response(): void {
        // No access_token, no expires_in, no token_type, no scope — FR-021 keeps
        // nothing, so a response carrying only the ID token is entirely sufficient.
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken()])]);

        $identity = $this->service()->identityFromCode('the-code', 'the-verifier');

        $this->assertSame(self::SUB, $identity->sub);
        $this->assertSame('visitor@example.com', $identity->email);
        $this->assertSame('A Visitor', $identity->displayName());
        $this->assertTrue($identity->isEmailVerified);
    }

    // ------------------------------------------------------- provider-level refusals

    /**
     * Bodies and statuses rather than built responses: a data provider runs before the
     * application is booted, so the Http facade is not resolvable inside one.
     *
     * @return array<string, array{array<string, mixed>|string, int}>
     */
    public static function unusableResponses(): array {
        return [
            'a server error' => ['', 500],
            'an unauthorized client' => [['error' => 'invalid_client'], 401],
            'a body without an id_token' => [['access_token' => 'ya29.x'], 200],
            'an id_token that is not a token' => [['id_token' => 'not-a-jwt'], 200],
            'an empty id_token' => [['id_token' => ''], 200],
        ];
    }

    #[DataProvider('unusableResponses')]
    public function test_an_unusable_token_response_is_a_provider_failure(array|string $body, int $status): void {
        Http::fake([self::TOKEN_URL => Http::response($body, $status)]);

        $this->expectException(OAuthFailure::class);

        try {
            $this->service()->identityFromCode('the-code', 'the-verifier');
        }
        catch (OAuthFailure $failure) {
            $this->assertSame(OAuthFailure::PROVIDER, $failure->failureCode);

            throw $failure;
        }
    }

    /**
     * @return array<string, array{array<string, mixed>}>
     */
    public static function untrustworthyClaims(): array {
        return [
            'a token minted for another application' => [['aud' => 'someone-else.apps.googleusercontent.com']],
            'an issuer that is not Google' => [['iss' => 'https://accounts.evil.example']],
            'an expired token' => [['exp' => time() - 1]],
            'a sub that is too wide for the column' => [['sub' => str_repeat('9', 256)]],
            'an address that is not an address' => [['email' => 'not-an-address']],
        ];
    }

    #[DataProvider('untrustworthyClaims')]
    public function test_an_untrustworthy_claim_set_is_a_provider_failure(array $overrides): void {
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken($overrides)])]);

        try {
            $this->service()->identityFromCode('the-code', 'the-verifier');
            $this->fail('Expected the claim set to be refused.');
        }
        catch (OAuthFailure $failure) {
            $this->assertSame(OAuthFailure::PROVIDER, $failure->failureCode);
        }
    }

    public function test_the_bare_issuer_form_is_accepted(): void {
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken(['iss' => 'accounts.google.com'])])]);

        // Google has issued both forms over the years; both are legitimate.
        $this->assertSame(self::SUB, $this->service()->identityFromCode('the-code', 'the-verifier')->sub);
    }

    // -------------------------------------------------------- the FR-005 email guard

    /**
     * @return array<string, array{array<string, mixed>}>
     */
    public static function unconfirmedAddresses(): array {
        return [
            'email_verified false' => [['email_verified' => false]],
            'email_verified absent' => [['email_verified' => null]],
            'email_verified as the string false' => [['email_verified' => 'false']],
            'email_verified as zero' => [['email_verified' => 0]],
            'no email claim at all' => [['email' => null]],
        ];
    }

    #[DataProvider('unconfirmedAddresses')]
    public function test_an_unconfirmed_address_is_refused_before_any_account_is_touched(array $overrides): void {
        Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken($overrides)])]);

        try {
            $this->service()->identityFromCode('the-code', 'the-verifier');
            $this->fail('Expected the unconfirmed address to be refused.');
        }
        catch (OAuthFailure $failure) {
            // Distinct from `provider`: this one has an action the visitor can take.
            $this->assertSame(OAuthFailure::UNVERIFIED_EMAIL, $failure->failureCode);
        }
    }

    public function test_the_string_true_and_the_integer_one_both_confirm_an_address(): void {
        foreach (['true', 1] as $claim) {
            Http::fake([self::TOKEN_URL => Http::response(['id_token' => self::idToken(['email_verified' => $claim])])]);

            $this->assertTrue($this->service()->identityFromCode('the-code', 'the-verifier')->isEmailVerified);
        }
    }
}
