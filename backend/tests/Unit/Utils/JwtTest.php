<?php

declare(strict_types=1);

namespace Tests\Unit\Utils;

use App\Exceptions\OAuthFailure;
use App\Utils\Jwt;
use Tests\TestCase;

final class JwtTest extends TestCase {
    private const AUDIENCE = '1234-client.apps.googleusercontent.com';

    /** Google issues both spellings; both must be accepted (research D5). */
    private const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

    public function test_the_payload_claims_are_returned(): void {
        $claims = Jwt::claims($this->token(['sub' => '1234567890', 'email' => 'ada@example.com']), self::AUDIENCE, self::ISSUERS);

        $this->assertSame('1234567890', $claims['sub']);
        $this->assertSame('ada@example.com', $claims['email']);
    }

    public function test_a_payload_decodes_at_every_padding_length(): void {
        // base64url strips the '=' padding, so the segment's length mod 4 varies with
        // the payload's byte length. All three cases must decode, which is what the
        // explicit padding restoration in Jwt is for.
        $decoded = 0;
        foreach (['a', 'ab', 'abc', 'abcd'] as $filler) {
            $claims = Jwt::claims($this->token(['sub' => $filler]), self::AUDIENCE, self::ISSUERS);
            $this->assertSame($filler, $claims['sub']);
            $decoded++;
        }

        $this->assertSame(4, $decoded);
    }

    public function test_a_payload_that_still_carries_its_padding_decodes(): void {
        // A provider that does not strip the padding is still decodable — '=' is legal
        // padding, not a malformed character. Which of the three fillers actually
        // produces padding depends on the encoded byte length, so all three are fed in
        // and the test asserts that at least one genuinely carried some.
        $padded = 0;
        foreach (['a', 'ab', 'abc'] as $filler) {
            $payload = strtr(base64_encode((string) json_encode($this->validClaims(['sub' => $filler]))), '+/', '-_');
            $padded += str_contains($payload, '=') ? 1 : 0;

            $claims = Jwt::claims('header.' . $payload . '.signature', self::AUDIENCE, self::ISSUERS);
            $this->assertSame($filler, $claims['sub']);
        }

        $this->assertGreaterThan(0, $padded, 'no fixture carried padding, so nothing was proved');
    }

    public function test_the_signature_segment_is_never_inspected(): void {
        // Research D5: the token arrives directly from the token endpoint over TLS on
        // a connection authenticated with our client secret, so the channel already
        // proves the issuer. An arbitrary signature must therefore still pass — this
        // is the assertion that the design is what got implemented.
        $token = $this->token(['sub' => '1234567890'], 'not-even-base64-!!');

        $this->assertSame('1234567890', Jwt::claims($token, self::AUDIENCE, self::ISSUERS)['sub']);
    }

    public function test_a_token_without_three_segments_is_refused(): void {
        foreach (['', 'header', 'header.payload', 'header.payload.signature.extra'] as $token) {
            $this->assertRefused($token);
        }
    }

    public function test_a_malformed_payload_segment_is_refused(): void {
        $this->assertRefused('header.!!!!.signature');
    }

    public function test_a_non_json_payload_is_refused(): void {
        $this->assertRefused('header.' . $this->segment('not json at all') . '.signature');
    }

    public function test_a_payload_that_is_a_json_scalar_is_refused(): void {
        // json_decode('123') succeeds and yields an int; claims must be an object.
        $this->assertRefused('header.' . $this->segment('123') . '.signature');
    }

    public function test_both_google_issuer_spellings_are_accepted(): void {
        foreach (self::ISSUERS as $issuer) {
            $claims = Jwt::claims($this->token(['iss' => $issuer]), self::AUDIENCE, self::ISSUERS);
            $this->assertSame($issuer, $claims['iss']);
        }
    }

    public function test_a_foreign_issuer_is_refused(): void {
        $this->assertRefused($this->token(['iss' => 'https://accounts.evil.com']));
    }

    public function test_an_absent_issuer_is_refused(): void {
        $this->assertRefused($this->token(['iss' => null]));
    }

    public function test_an_audience_mismatch_is_refused(): void {
        // This is what stops a token minted for a DIFFERENT application being
        // replayed at ours (research D5).
        $this->assertRefused($this->token(['aud' => 'someone-else.apps.googleusercontent.com']));
    }

    public function test_an_absent_audience_is_refused(): void {
        $this->assertRefused($this->token(['aud' => null]));
    }

    public function test_an_expired_token_is_refused(): void {
        $this->assertRefused($this->token(['exp' => time() - 1]));
    }

    public function test_a_token_expiring_exactly_now_is_refused(): void {
        // No leeway: `exp` must be strictly in the future (research D5).
        $this->assertRefused($this->token(['exp' => time()]));
    }

    public function test_an_absent_expiry_is_refused(): void {
        $this->assertRefused($this->token(['exp' => null]));
    }

    private function assertRefused(string $token): void {
        try {
            Jwt::claims($token, self::AUDIENCE, self::ISSUERS);
        }
        catch (OAuthFailure $failure) {
            // Every claim-level rejection is a `provider` refusal, never a distinct
            // code — the visitor cannot act on which check failed (research D10).
            $this->assertSame(OAuthFailure::PROVIDER, $failure->failureCode);

            return;
        }

        $this->fail('the token should have been refused: ' . $token);
    }

    /**
     * A valid claim set, with the given keys overridden. A null override removes the
     * claim, so "absent" and "wrong" are both expressible.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function validClaims(array $overrides = []): array {
        $claims = array_merge([
            'iss' => 'https://accounts.google.com',
            'aud' => self::AUDIENCE,
            'exp' => time() + 600,
            'sub' => '1234567890',
        ], $overrides);

        return array_filter($claims, fn ($value) => $value !== null);
    }

    /**
     * Synthesize a token as three base64url segments (research D16) — no signing key
     * anywhere, because none is needed to read it.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function token(array $overrides = [], string $signature = 'signature'): string {
        return $this->segment(['alg' => 'RS256'])
            . '.' . $this->segment($this->validClaims($overrides))
            . '.' . $signature;
    }

    private function segment(mixed $data): string {
        $json = is_string($data) ? $data : (string) json_encode($data);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }
}
