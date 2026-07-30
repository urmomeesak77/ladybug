<?php

declare(strict_types=1);

namespace App\Utils;

use App\Exceptions\OAuthFailure;

/**
 * Reads the claims out of an ID token that was received directly from an OpenID
 * Connect token endpoint.
 *
 * The RS256 signature is deliberately NOT verified (research D5): the token arrives
 * over a TLS channel we authenticated with our own client secret, so the channel
 * already establishes issuer authenticity — which is the only thing the signature
 * adds. Verifying it would mean JWKS fetching, caching and key rotation, which is
 * the part that would genuinely justify a package and would buy nothing here,
 * because the token never traverses the browser. `iss`, `aud` and `exp` are checked
 * instead, with no leeway. If the token ever started arriving via the browser
 * (implicit/hybrid), this reasoning would collapse — which is why the flow is pinned
 * to `response_type=code`.
 *
 * `App\Utils\Base64` is not the tool for the decode: it is an integer→string encoder
 * for minting public hashes, not a byte codec, so it cannot decode a JWT segment.
 */
class Jwt {
    /**
     * The token's claims, or an OAuthFailure('provider') if anything about it is
     * unusable. Every rejection carries the same code: which check failed is not
     * something the visitor can act on (research D10).
     *
     * @param  list<string>  $issuers  the accepted `iss` values
     * @return array<string, mixed>
     */
    public static function claims(string $token, string $audience, array $issuers): array {
        $claims = self::payload($token);
        self::verify($claims, $audience, $issuers);

        return $claims;
    }

    /**
     * Decode the middle segment. The third segment is read only to confirm the token
     * has three of them — its contents are never inspected (see the class note).
     *
     * @return array<string, mixed>
     */
    private static function payload(string $token): array {
        $segments = explode('.', $token);
        if (count($segments) !== 3) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        // Strict decoding, so a segment carrying anything outside the alphabet is a
        // refusal rather than a silently truncated payload.
        $json = base64_decode(self::pad(strtr($segments[1], '-_', '+/')), true);
        if ($json === false) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        $claims = json_decode($json, true);
        if (! is_array($claims)) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        return $claims;
    }

    /**
     * Restore the '=' padding base64url strips. A segment that still carries its own
     * padding is already a multiple of four and is left alone.
     */
    private static function pad(string $segment): string {
        return str_pad($segment, intdiv(strlen($segment) + 3, 4) * 4, '=');
    }

    /**
     * The three checks that replace the signature. An absent claim fails the same way
     * a wrong one does, so there is no branch to forget.
     *
     * @param  array<string, mixed>  $claims
     * @param  list<string>  $issuers
     */
    private static function verify(array $claims, string $audience, array $issuers): void {
        if (! in_array($claims['iss'] ?? null, $issuers, true)) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        // Strict comparison against our own client id: this is what stops a token
        // minted for a different application being replayed at ours.
        if (($claims['aud'] ?? null) !== $audience) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        // No leeway, and a missing `exp` reads as 0 — expiry is not optional.
        if ((int) ($claims['exp'] ?? 0) <= time()) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }
    }
}
