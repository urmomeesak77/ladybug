<?php

declare(strict_types=1);

use App\Http\Middleware\ApplyRememberMeLifetime;
use App\Http\Middleware\EnsureAccountEnabled;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\SlideRememberMeCookie;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum SPA auth: requests from the configured stateful frontend domains
        // are authenticated via the session cookie (CSRF-protected) instead of a token.
        $middleware->statefulApi();

        // "Remember me" (research D3): must run BEFORE Sanctum's own prepended stateful
        // middleware so session.lifetime is raised ahead of the session being started/read.
        // prependToGroup inserts at the front, so calling it here (after statefulApi()) puts
        // this middleware ahead of Sanctum's own prepended EnsureFrontendRequestsAreStateful.
        $middleware->prependToGroup('api', ApplyRememberMeLifetime::class);

        // Live-session revocation (FR-014): appended AFTER statefulApi so the session is
        // started and $request->user() resolves before it runs. A disabled account's next
        // request is refused and its session torn down (research D3).
        $middleware->appendToGroup('api', EnsureAccountEnabled::class);

        // "Remember me" (research D2 step 3): appended AFTER EnsureAccountEnabled so a
        // request that middleware already rejected never gets its remember cookie renewed.
        $middleware->appendToGroup('api', SlideRememberMeCookie::class);

        // `role:admin` (etc.) gates a route to accounts of at least the named role.
        $middleware->alias(['role' => EnsureRole::class]);

        // The production stack binds to 127.0.0.1:8080 and is reachable only by the edge
        // nginx on the same host, so every proxy that can reach us is ours to trust. Without
        // this Laravel sees the proxy's IP and scheme http: signed verification links would
        // be built (and validated) over the wrong scheme, media URLs would be http, and the
        // uploads/comments rate limiters would key every visitor to one bucket.
        $middleware->trustProxies(at: '*');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
