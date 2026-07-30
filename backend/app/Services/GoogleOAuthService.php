<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\OAuthFailure;
use App\Support\GoogleIdentity;
use App\Support\OAuthFlowState;
use App\Utils\Jwt;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Everything this feature says to Google, and nothing it says to the database.
 *
 * That split is deliberate (research D17): this class is the only one that makes a
 * network call, and IdentityLinkService is the only one that writes a row. Keeping
 * them apart is what lets each be tested exhaustively on its own terms — this file's
 * suite is pure Http::fake() with no database, and the link service's is pure database
 * with no HTTP. A single "GoogleAuthService" doing both would force every account test
 * to also stub a token endpoint.
 */
class GoogleOAuthService {
    /** The minimum FR-002 permits: identity and address, no Drive, no contacts. */
    private const SCOPES = 'openid email profile';

    /** A hung provider must not hold a php-fpm worker (contract §token exchange). */
    private const TIMEOUT_SECONDS = 10;

    /** Google has issued both forms; both are legitimate `iss` values. */
    private const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

    /**
     * Whether a sign-in can even be attempted. An unconfigured deployment answers
     * `?error=provider` rather than hiding the button, so the control's presence never
     * depends on server state (research D12) and the e2e stack can run with empty keys.
     */
    public function isConfigured(): bool {
        foreach (['client_id', 'client_secret', 'redirect_uri'] as $key) {
            if ((string) config("services.google.{$key}", '') === '') {
                return false;
            }
        }

        return true;
    }

    /**
     * Where to send the browser to ask Google. Only the PKCE *challenge* travels; the
     * verifier stays in the session, so an authorization code intercepted in between is
     * not redeemable (research D4).
     */
    public function authorizeUrl(string $state, string $verifier): string {
        return (string) config('services.google.authorize_url') . '?' . http_build_query([
            'response_type' => 'code',
            'client_id' => (string) config('services.google.client_id'),
            'redirect_uri' => (string) config('services.google.redirect_uri'),
            'scope' => self::SCOPES,
            'state' => $state,
            'code_challenge' => OAuthFlowState::challenge($verifier),
            'code_challenge_method' => 'S256',
            // Google issues no refresh token at all under `online`, so FR-021 has
            // nothing to discard — the safest way to not retain a credential.
            'access_type' => 'online',
            'prompt' => 'select_account',
        ]);
    }

    /**
     * Redeem the authorization code and return the identity Google asserted.
     *
     * Identity comes from here and nowhere else: no attribute arriving on the callback
     * URL is ever trusted (FR-004, research D5).
     */
    public function identityFromCode(string $code, string $verifier): GoogleIdentity {
        $claims = Jwt::claims(
            $this->exchange($code, $verifier),
            (string) config('services.google.client_id'),
            self::ISSUERS,
        );

        return $this->identity($claims);
    }

    /**
     * The server-to-server call, returning the raw ID token. Every way it can fail —
     * refused, unreachable, or answered without a token — is one `provider` refusal:
     * which of them happened is not something the visitor can act on.
     */
    private function exchange(string $code, string $verifier): string {
        try {
            // No ->retry(): Google's authorization codes are single-use, so a second
            // attempt could not succeed and would only double the time a worker is held.
            $response = Http::asForm()->timeout(self::TIMEOUT_SECONDS)->post((string) config('services.google.token_url'), [
                'code' => $code,
                'client_id' => (string) config('services.google.client_id'),
                'client_secret' => (string) config('services.google.client_secret'),
                'redirect_uri' => (string) config('services.google.redirect_uri'),
                'grant_type' => 'authorization_code',
                'code_verifier' => $verifier,
            ]);
        }
        catch (ConnectionException $e) {
            report($e);

            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        if (! $response->successful()) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        // Only `id_token` is read. `access_token`, `expires_in`, `token_type` and
        // `scope` are never touched and never stored (FR-021): nothing retained is
        // nothing that can leak.
        $token = $response->json('id_token');

        if (! is_string($token) || $token === '') {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        return $token;
    }

    /**
     * The claims as a bounded value object, with FR-005's guard in front of it.
     *
     * The address is checked for PRESENCE here rather than inside GoogleIdentity
     * because an absent address and a malformed one are different refusals: no address
     * means "sign in with e-mail and password instead", which the visitor can act on,
     * while a malformed one is the provider misbehaving.
     *
     * @param  array<string, mixed>  $claims
     */
    private function identity(array $claims): GoogleIdentity {
        if (! is_scalar($claims['email'] ?? null) || (string) $claims['email'] === '') {
            throw new OAuthFailure(OAuthFailure::UNVERIFIED_EMAIL);
        }

        $identity = GoogleIdentity::fromClaims($claims);

        // The load-bearing guard under the whole auto-link rule (FR-005): an address
        // Google has not confirmed must never reach account resolution, or anyone could
        // claim a stranger's address at an identity provider and inherit their account.
        if (! $identity->isEmailVerified) {
            throw new OAuthFailure(OAuthFailure::UNVERIFIED_EMAIL);
        }

        return $identity;
    }
}
