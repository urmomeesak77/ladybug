<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\CanResetPassword;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider {
    /**
     * Register any application services.
     */
    public function register(): void {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void {
        // Named limiters so the per-minute caps are env-tunable (config/app.php):
        // production keeps the strict defaults, while the disposable e2e stack raises
        // them — its specs register several real users per run and must not 429.
        RateLimiter::for('auth', $this->authLimit(...));
        RateLimiter::for('uploads', $this->uploadLimit(...));
        RateLimiter::for('comments', $this->commentLimit(...));
        RateLimiter::for('password', $this->passwordLimit(...));
        VerifyEmail::createUrlUsing(self::verificationLinkFor(...));
        ResetPassword::createUrlUsing(self::recoveryLinkFor(...));
    }

    /**
     * Build the recovery email's link (022, contracts/recovery-link.md):
     *
     *     {FRONTEND_URL}/reset-password/{sha1(email)}#token={token}
     *
     * The path carries the same address digest the verification link above carries, so no
     * page in the journey — and no address bar — prints an account detail (FR-011). The
     * token rides in the FRAGMENT, which no browser ever sends to a server: in production
     * every SPA address is proxied to Laravel's ShellController, so a token in the path or
     * the query would land in nginx's access log AND in PHP. The fragment makes FR-018 a
     * property of this line rather than of three nginx configs kept in step (research D2).
     */
    private static function recoveryLinkFor(CanResetPassword $notifiable, string $token): string {
        $hash = sha1((string) $notifiable->getEmailForPasswordReset());

        return config('app.frontend_url') . '/reset-password/' . $hash . '#token=' . $token;
    }

    /**
     * Build the verification email's link: the signed components of the RELATIVE
     * API route (origin-independent, so the same signature holds on any host the
     * API answers as — research D3) wrapped in the SPA's origin, where the
     * landing page forwards them back to the API. The link carries no user id,
     * only the sha1 digest of the recipient's own address.
     */
    private static function verificationLinkFor(MustVerifyEmail $notifiable): string {
        $hash = sha1((string) $notifiable->getEmailForVerification());
        $signed = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes((int) config('auth.verification.expire')),
            ['hash' => $hash],
            absolute: false,
        );

        return config('app.frontend_url') . '/verify-email/' . $hash . '?' . (string) parse_url($signed, PHP_URL_QUERY);
    }

    /**
     * Login/register cap, keyed by client IP: slows credential guessing and bulk
     * account creation (Principle VI).
     */
    private function authLimit(Request $request): Limit {
        return Limit::perMinute((int) config('app.auth_throttle'))->by((string) $request->ip());
    }

    /**
     * Post-creation cap, keyed by the authenticated user (falling back to IP before
     * auth resolves): uploads are heavier than reads (image processing, disk writes).
     */
    private function uploadLimit(Request $request): Limit {
        $key = $request->user()?->getAuthIdentifier() ?? $request->ip();

        return Limit::perMinute((int) config('app.upload_throttle'))->by((string) $key);
    }

    /**
     * Password recovery/change cap (022). A SEPARATE bucket from `auth` on purpose: the
     * recovery endpoints are anonymous and cheap to hammer, but exhausting their cap must
     * never lock the visitor out of `POST /api/login` with the password they do remember
     * (research D7). Laravel namespaces a named limiter's counter by its name, so
     * registering it under `password` is what buys that separation.
     *
     * Keyed by the authenticated account where there is one — the account-page change is
     * behind auth:sanctum, and keying it per-account stops one user on a shared office IP
     * from spending everyone's allowance — falling back to IP for the anonymous recovery
     * endpoints. It shares `auth`'s cap value because both guard credential attempts.
     */
    private function passwordLimit(Request $request): Limit {
        $key = $request->user()?->getAuthIdentifier() ?? $request->ip();

        return Limit::perMinute((int) config('app.auth_throttle'))->by((string) $key);
    }

    /**
     * Per-user comment cap: comment creation is auth-gated, so key by the authenticated
     * user (falling back to IP before auth resolves) to bound comment spam (Principle VI, D8).
     */
    private function commentLimit(Request $request): Limit {
        $key = $request->user()?->getAuthIdentifier() ?? $request->ip();

        return Limit::perMinute((int) config('app.comment_throttle'))->by((string) $key);
    }
}
