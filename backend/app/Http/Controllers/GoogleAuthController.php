<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Exceptions\OAuthFailure;
use App\Services\GoogleOAuthService;
use App\Services\IdentityLinkService;
use App\Support\OAuthFlowState;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The two browser-facing endpoints of the Google flow. Both are reached by a top-level
 * navigation, so NEITHER ever returns JSON: every exit — success, refusal, and provider
 * outage alike — is a 302 to a real SPA page (FR-007, SC-005). A visitor must never see
 * a blank page or a raw error.
 *
 * Every refusal raised anywhere beneath this class arrives as one OAuthFailure and is
 * turned into `?error={code}` by the single catch in callback(), which is why the error
 * path here is not a chain of ifs.
 */
class GoogleAuthController extends Controller {
    /** One bucket for both doors, so a flood cannot be split across them. */
    private const LIMIT_KEY = 'google-oauth:';

    private const LIMIT_DECAY_SECONDS = 60;

    public function __construct(
        private readonly GoogleOAuthService $google,
        private readonly IdentityLinkService $identities,
    ) {
    }

    /**
     * Start the flow: mint the state and send the browser to Google.
     *
     * The order of the three guards is load-bearing. The authenticated check runs
     * BEFORE the limiter so a signed-in visitor's stray click cannot consume another
     * visitor's IP budget, and the configuration check runs before anything is written
     * so an unconfigured deployment leaves no half-started flow behind.
     */
    public function redirect(Request $request): RedirectResponse {
        // FR-031, research D9: no flow starts, nothing is written, and which account is
        // signed in cannot be swapped. The SPA's RequireAnon guard is the client-side
        // mirror of this.
        if ($request->user() !== null) {
            return $this->toFrontend('/');
        }

        if ($this->isRateLimited($request)) {
            return $this->toLogin(OAuthFailure::RATE_LIMITED);
        }

        if (! $this->google->isConfigured()) {
            return $this->toLogin(OAuthFailure::PROVIDER);
        }

        $flow = OAuthFlowState::mint($request->session(), $this->queryString($request, 'redirect'));

        return redirect()->away($this->google->authorizeUrl($flow['state'], $flow['code_verifier']));
    }

    /**
     * Google's return trip. The flow state is consumed at the top, so it is gone
     * whichever way this request ends — that is what makes a replay fail.
     */
    public function callback(Request $request): RedirectResponse {
        if ($this->isRateLimited($request)) {
            return $this->toLogin(OAuthFailure::RATE_LIMITED);
        }

        $flow = OAuthFlowState::consume($request->session());

        try {
            $this->refuseProviderError($request);
            $validated = OAuthFlowState::validate($flow, $this->queryString($request, 'state'));
            $user = $this->identities->resolve(
                $this->google->identityFromCode($this->code($request), (string) $validated['code_verifier']),
            );

            Auth::login($user);
            // Rotate the session id after authenticating to prevent session fixation,
            // exactly as AuthController::register and ::login do.
            $request->session()->regenerate();

            return $this->toFrontend((string) $validated['redirect']);
        }
        catch (OAuthFailure $failure) {
            return $this->toLogin($failure->failureCode);
        }
    }

    /**
     * A query parameter, but only when it is actually a string.
     *
     * Everything on these two URLs arrives from the browser, and PHP's query parser
     * happily produces an ARRAY from `?redirect[]=x`. Handed to a `?string` parameter
     * under strict_types that is an uncaught TypeError — a 500, which is precisely the
     * raw error FR-007 and SC-005 say a visitor must never reach. Anything that is not
     * a string is therefore treated as absent, and the ordinary default or refusal
     * takes over.
     */
    private function queryString(Request $request, string $key): ?string {
        $value = $request->query($key);

        return is_string($value) ? $value : null;
    }

    /**
     * Google's own `error` parameter, before anything else is read from this URL. A
     * declined consent screen is not a failure the visitor needs explaining; every
     * other value is the provider's problem, not theirs.
     */
    private function refuseProviderError(Request $request): void {
        $error = $request->query('error');
        if ($error === null) {
            return;
        }

        throw new OAuthFailure($error === 'access_denied' ? OAuthFailure::CANCELLED : OAuthFailure::PROVIDER);
    }

    /**
     * The authorization code. An absent one is reported as a `state` failure rather
     * than its own code: a return trip missing it is indistinguishable from a tampered
     * one, and naming the difference would tell an attacker which half they beat.
     */
    private function code(Request $request): string {
        $code = $request->query('code');
        if (! is_string($code) || $code === '') {
            throw new OAuthFailure(OAuthFailure::STATE);
        }

        return $code;
    }

    /**
     * Whether this IP is past the cap, counting the attempt when it is not.
     *
     * Checked here in the controller rather than with the `throttle:` middleware
     * (research D11): that middleware renders Laravel's HTML 429 page, and FR-007
     * requires every exit from these two routes to be a redirect to a real SPA page.
     *
     * `hit()` runs only after the check passes, so a refused request does not deepen
     * its own hole and a visitor waiting out the window actually gets out of it.
     */
    private function isRateLimited(Request $request): bool {
        $key = self::LIMIT_KEY . $request->ip();
        // The same cap POST /api/login uses — one door should not be looser than the other.
        if (RateLimiter::tooManyAttempts($key, (int) config('app.auth_throttle'))) {
            return true;
        }

        RateLimiter::hit($key, self::LIMIT_DECAY_SECONDS);

        return false;
    }

    /** The SPA login page carrying one of the seven closed error codes. */
    private function toLogin(string $code): RedirectResponse {
        return $this->toFrontend('/login?error=' . $code);
    }

    /**
     * Away from the API and onto the SPA. `$path` is always either a literal written
     * here or a value OAuthFlowState already validated on the way in — it is never
     * raw input at this point.
     */
    private function toFrontend(string $path): RedirectResponse {
        return redirect()->away(rtrim((string) config('app.frontend_url'), '/') . $path);
    }
}
