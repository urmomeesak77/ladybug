<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Exceptions\OAuthFailure;
use App\Support\OAuthFlowState;
use Illuminate\Contracts\Session\Session;
use Tests\TestCase;

/**
 * No HTTP anywhere in this file: the flow state is pure given a session store, and never
 * calls ->save(), so it never touches whichever handler SESSION_DRIVER resolves to
 * (data-model §4, research D3).
 */
final class OAuthFlowStateTest extends TestCase {
    public function test_mint_writes_the_whole_flow_under_one_key(): void {
        $session = $this->store();

        OAuthFlowState::mint($session, '/posts/abc');

        $flow = $session->get(OAuthFlowState::SESSION_KEY);
        $this->assertIsArray($flow);
        $this->assertSame(['state', 'code_verifier', 'expires_at', 'redirect'], array_keys($flow));
    }

    public function test_the_state_is_sixty_four_hex_characters(): void {
        // 256 bits from random_bytes — FR-003's "unguessable" (research D3).
        $flow = OAuthFlowState::mint($this->store(), null);

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $flow['state']);
    }

    public function test_the_code_verifier_is_sixty_four_hex_characters(): void {
        $flow = OAuthFlowState::mint($this->store(), null);

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $flow['code_verifier']);
    }

    public function test_the_state_and_the_verifier_are_different_secrets(): void {
        $flow = OAuthFlowState::mint($this->store(), null);

        $this->assertNotSame($flow['state'], $flow['code_verifier']);
    }

    public function test_two_flows_do_not_share_a_state(): void {
        $first = OAuthFlowState::mint($this->store(), null);
        $second = OAuthFlowState::mint($this->store(), null);

        $this->assertNotSame($first['state'], $second['state']);
    }

    public function test_the_flow_expires_ten_minutes_out(): void {
        $flow = OAuthFlowState::mint($this->store(), null);

        $this->assertSame(time() + 600, $flow['expires_at']);
    }

    public function test_minting_twice_replaces_the_earlier_flow(): void {
        // One flow per browser: starting again abandons the first, so a state minted
        // for an earlier attempt cannot be redeemed afterwards (data-model §4).
        $session = $this->store();
        $first = OAuthFlowState::mint($session, null);
        $second = OAuthFlowState::mint($session, null);

        $this->assertSame($second['state'], $session->get(OAuthFlowState::SESSION_KEY)['state']);
        $this->assertNotSame($first['state'], $session->get(OAuthFlowState::SESSION_KEY)['state']);
    }

    public function test_consume_reads_and_removes_in_one_operation(): void {
        $session = $this->store();
        $minted = OAuthFlowState::mint($session, '/posts/abc');

        $flow = OAuthFlowState::consume($session);

        $this->assertSame($minted['state'], $flow['state']);
        $this->assertFalse($session->has(OAuthFlowState::SESSION_KEY));
    }

    public function test_a_replayed_consume_finds_nothing(): void {
        // Single-use is what makes a reloaded return URL a `state` refusal rather than
        // a second sign-in (FR-003, US4 AS5).
        $session = $this->store();
        OAuthFlowState::mint($session, null);
        OAuthFlowState::consume($session);

        $this->assertNull(OAuthFlowState::consume($session));
    }

    public function test_validate_returns_the_flow_when_the_state_matches(): void {
        $session = $this->store();
        $minted = OAuthFlowState::mint($session, '/posts/abc');

        $flow = OAuthFlowState::validate(OAuthFlowState::consume($session), $minted['state']);

        $this->assertSame('/posts/abc', $flow['redirect']);
    }

    public function test_validate_refuses_an_absent_flow(): void {
        $this->assertRefused(null, 'anything');
    }

    public function test_validate_refuses_an_absent_returned_state(): void {
        $session = $this->store();
        OAuthFlowState::mint($session, null);

        $this->assertRefused(OAuthFlowState::consume($session), null);
    }

    public function test_validate_refuses_a_mismatched_state(): void {
        $session = $this->store();
        OAuthFlowState::mint($session, null);

        $this->assertRefused(OAuthFlowState::consume($session), str_repeat('0', 64));
    }

    public function test_validate_refuses_a_state_that_is_a_prefix_of_the_real_one(): void {
        // hash_equals, not ==: a length-or-content comparison must not leak a match
        // position, and a truncated state is not a match at all.
        $session = $this->store();
        $minted = OAuthFlowState::mint($session, null);

        $this->assertRefused(OAuthFlowState::consume($session), substr($minted['state'], 0, 63));
    }

    public function test_validate_refuses_an_expired_flow(): void {
        $flow = ['state' => str_repeat('a', 64), 'code_verifier' => 'v', 'expires_at' => time() - 1, 'redirect' => '/'];

        $this->assertRefused($flow, $flow['state']);
    }

    public function test_validate_refuses_a_flow_expiring_exactly_now(): void {
        $flow = ['state' => str_repeat('a', 64), 'code_verifier' => 'v', 'expires_at' => time(), 'redirect' => '/'];

        $this->assertRefused($flow, $flow['state']);
    }

    public function test_validate_refuses_a_flow_with_no_state_at_all(): void {
        $this->assertRefused(['expires_at' => time() + 600, 'redirect' => '/'], '');
    }

    public function test_the_challenge_is_unpadded_base64url_of_the_verifier_digest(): void {
        // PKCE S256 (research D4): the verifier never leaves the session, so a leaked
        // authorization code is not redeemable on its own.
        $verifier = str_repeat('ab', 32);

        $challenge = OAuthFlowState::challenge($verifier);

        $expected = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $this->assertSame($expected, $challenge);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $challenge);
    }

    public function test_the_challenge_is_not_the_verifier(): void {
        $verifier = str_repeat('ab', 32);

        $this->assertNotSame($verifier, OAuthFlowState::challenge($verifier));
    }

    public function test_a_plain_path_survives_the_redirect_guard(): void {
        $this->assertSame('/posts/abc', $this->mintedRedirect('/posts/abc'));
    }

    public function test_a_path_with_a_query_string_survives_the_redirect_guard(): void {
        $this->assertSame('/posts/abc?x=1', $this->mintedRedirect('/posts/abc?x=1'));
    }

    public function test_the_redirect_guard_rejects_every_off_site_form(): void {
        // Open-redirect guard (Principle VI, research D10). The stored value is appended
        // to FRONTEND_URL, so anything that could re-point the host has to become '/'.
        $hostile = [
            'protocol-relative' => '//evil.com',
            'absolute' => 'https://evil.com',
            'backslash-relative' => '/\evil.com',
            'backslash only' => '/\\',
            'scheme-relative with credentials' => '//user@evil.com',
            'not a path at all' => 'evil.com',
            'empty' => '',
            'a bare fragment' => '#/posts/abc',
        ];

        foreach ($hostile as $label => $value) {
            $this->assertSame('/', $this->mintedRedirect($value), "expected '/' for the {$label} case");
        }
    }

    public function test_the_redirect_guard_rejects_smuggled_whitespace(): void {
        // A trailing newline is the interesting one: PCRE's '$' matches BEFORE a final
        // newline, so the pattern is anchored with \z instead. With '$' the value below
        // would be stored verbatim.
        foreach (["/posts/abc\n", "/posts/abc\r\n", "/posts /abc", "/posts\tabc", " /posts/abc", "\n/posts"] as $value) {
            $this->assertSame('/', $this->mintedRedirect($value), 'expected ' . json_encode($value) . ' to be refused');
        }
    }

    public function test_the_redirect_guard_rejects_an_overlong_path(): void {
        $this->assertSame('/', $this->mintedRedirect('/' . str_repeat('a', 512)));
    }

    public function test_the_redirect_guard_keeps_a_path_at_the_limit(): void {
        $limit = '/' . str_repeat('a', 511);

        $this->assertSame($limit, $this->mintedRedirect($limit));
    }

    public function test_an_absent_redirect_becomes_the_site_root(): void {
        $this->assertSame('/', $this->mintedRedirect(null));
    }

    public function test_the_guard_runs_before_storage(): void {
        // Validated on the way IN, so nothing downstream has to re-check the value it
        // reads back out of the session (research D10).
        $session = $this->store();
        OAuthFlowState::mint($session, '//evil.com');

        $this->assertSame('/', $session->get(OAuthFlowState::SESSION_KEY)['redirect']);
    }

    private function mintedRedirect(?string $redirect): string {
        return OAuthFlowState::mint($this->store(), $redirect)['redirect'];
    }

    /**
     * @param  array<string, mixed>|null  $flow
     */
    private function assertRefused(?array $flow, ?string $returnedState): void {
        try {
            OAuthFlowState::validate($flow, $returnedState);
        }
        catch (OAuthFailure $failure) {
            // One code for all five state failures: distinguishing "expired" from
            // "mismatched" from "replayed" tells an attacker which half of the guard
            // they beat (research D10).
            $this->assertSame(OAuthFailure::STATE, $failure->failureCode);

            return;
        }

        $this->fail('the flow should have been refused');
    }

    private function store(): Session {
        return $this->app->make('session.store');
    }
}
