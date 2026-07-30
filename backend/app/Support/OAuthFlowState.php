<?php

declare(strict_types=1);

namespace App\Support;

use App\Exceptions\OAuthFailure;
use Illuminate\Contracts\Session\Session;

/**
 * The transient state of one Google sign-in attempt: the CSRF `state`, the PKCE
 * verifier, an expiry, and the path to return to. It lives in the browser's own
 * session and nowhere else — no table, no pruning job (research D3).
 *
 * That location is what satisfies FR-003's "bound to the browser that started it":
 * a signed self-describing token would be unguessable and single-use, but it would
 * be redeemable from ANY browser, which is the property the requirement is about.
 */
class OAuthFlowState {
    public const SESSION_KEY = 'oauth.google';

    private const TTL_SECONDS = 600;

    private const DEFAULT_REDIRECT = '/';

    private const MAX_REDIRECT_LENGTH = 512;

    /**
     * A path on this site and nothing else. Anchored with \z rather than '$' because
     * PCRE's '$' matches BEFORE a final newline, which would let "/posts\n" through —
     * the value is appended to FRONTEND_URL, so a smuggled terminator is a real
     * finding, not a theoretical one. The negative look-ahead rejects '//evil.com'
     * and '/\evil.com', both of which browsers resolve as another origin.
     */
    private const SAFE_REDIRECT = '#^/(?![/\\\\])[^\s]*\z#';

    /**
     * Write a fresh flow, replacing any earlier one in this browser, and return it so
     * the caller can build the authorize URL from the same values.
     *
     * @return array{state: string, code_verifier: string, expires_at: int, redirect: string}
     */
    public static function mint(Session $session, ?string $redirect): array {
        $flow = [
            // 256 bits: FR-003's "unguessable".
            'state' => bin2hex(random_bytes(32)),
            'code_verifier' => bin2hex(random_bytes(32)),
            'expires_at' => time() + self::TTL_SECONDS,
            // Validated on the way IN, so nothing that reads it back out has to
            // re-check it (research D10).
            'redirect' => self::safeRedirect($redirect),
        ];

        $session->put(self::SESSION_KEY, $flow);

        return $flow;
    }

    /**
     * Read the flow AND remove it, in one operation. That is what makes the state
     * single-use with no separate cleanup step: a replayed return finds nothing.
     *
     * @return array<string, mixed>|null
     */
    public static function consume(Session $session): ?array {
        $flow = $session->pull(self::SESSION_KEY);

        return is_array($flow) ? $flow : null;
    }

    /**
     * Return the flow if it matches the state Google sent back and has not expired.
     *
     * All five ways this can fail — absent, no stored state, mismatched, expired, and
     * the absence a replay produces — raise the SAME code. Distinguishing them would
     * tell an attacker which half of the guard they beat (research D10).
     *
     * @param  array<string, mixed>|null  $flow
     * @return array<string, mixed>
     */
    public static function validate(?array $flow, ?string $returnedState): array {
        $stored = $flow['state'] ?? null;
        if (! is_string($stored) || ! is_string($returnedState)) {
            throw new OAuthFailure(OAuthFailure::STATE);
        }

        // Constant-time, and length-safe: a truncated state is not a match.
        if (! hash_equals($stored, $returnedState)) {
            throw new OAuthFailure(OAuthFailure::STATE);
        }

        // No leeway, and an absent expiry reads as 0 — the TTL is not optional.
        if ((int) ($flow['expires_at'] ?? 0) <= time()) {
            throw new OAuthFailure(OAuthFailure::STATE);
        }

        return $flow;
    }

    /**
     * The PKCE S256 challenge for a verifier: unpadded base64url of its SHA-256 digest
     * (research D4). Only this travels to Google; the verifier stays in the session,
     * so an authorization code intercepted anywhere in between is not redeemable.
     */
    public static function challenge(string $verifier): string {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }

    /**
     * The intended path, or the site root if the value could point anywhere else.
     * Anything rejected becomes '/' silently: there is nothing for the visitor to
     * correct, and refusing the whole sign-in over it would be worse.
     */
    private static function safeRedirect(?string $redirect): string {
        if ($redirect === null || strlen($redirect) > self::MAX_REDIRECT_LENGTH) {
            return self::DEFAULT_REDIRECT;
        }

        return preg_match(self::SAFE_REDIRECT, $redirect) === 1 ? $redirect : self::DEFAULT_REDIRECT;
    }
}
