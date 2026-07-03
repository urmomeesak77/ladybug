<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
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
}
