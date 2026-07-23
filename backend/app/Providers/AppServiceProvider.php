<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
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
        VerifyEmail::createUrlUsing(self::verificationLinkFor(...));
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
     * Per-user comment cap: comment creation is auth-gated, so key by the authenticated
     * user (falling back to IP before auth resolves) to bound comment spam (Principle VI, D8).
     */
    private function commentLimit(Request $request): Limit {
        $key = $request->user()?->getAuthIdentifier() ?? $request->ip();

        return Limit::perMinute((int) config('app.comment_throttle'))->by((string) $key);
    }
}
