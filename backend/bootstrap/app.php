<?php

declare(strict_types=1);

use App\Http\Middleware\ApplyRememberMeLifetime;
use App\Http\Middleware\CaptureAccessLogActor;
use App\Http\Middleware\CollectStaleSessions;
use App\Http\Middleware\EnsureAccountEnabled;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\RecordAccessLog;
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
        // The access log (023): PREPENDED so it is the outermost global frame, ahead of
        // TrustProxies, HandleCors, PreventRequestsDuringMaintenance and ValidatePostSize.
        // Only from there does it see the requests FR-001 is hardest about — the ones a
        // guard rejected, and the ones whose thrown Throwable the routing pipeline rendered
        // into a response while unwinding (research D1). Registered first here so the
        // "outermost" property is visible at the top of the file, where it can be noticed
        // before anything else is prepended in front of it.
        $middleware->prepend(RecordAccessLog::class);

        // Sanctum SPA auth: requests from the configured stateful frontend domains
        // are authenticated via the session cookie (CSRF-protected) instead of a token.
        $middleware->statefulApi();

        // "Remember me" (research D3): must run BEFORE Sanctum's own prepended stateful
        // middleware so session.lifetime is raised ahead of the session being started/read.
        // prependToGroup inserts at the front, so calling it here (after statefulApi()) puts
        // this middleware ahead of Sanctum's own prepended EnsureFrontendRequestsAreStateful.
        $middleware->prependToGroup('api', ApplyRememberMeLifetime::class);

        // Same reasoning applies to the `web` group: Sanctum's SanctumServiceProvider
        // registers /sanctum/csrf-cookie under `web` (StartSession et al., no ApplyRememberMeLifetime),
        // and the frontend hits that route directly whenever its XSRF-TOKEN cookie is missing. Without
        // this, that request would start/read the session at the default 120-minute lifetime and could
        // silently downgrade or destroy an already-remembered 7-day session.
        $middleware->prependToGroup('web', ApplyRememberMeLifetime::class);

        // Replaces Laravel's own request-triggered session GC (session.lottery is disabled in
        // config/session.php — see SessionGarbageCollector's docblock): that built-in sweep
        // deletes every session row older than THIS request's config('session.lifetime'), which
        // for almost any request site-wide is the short default, not a remembered session's
        // real 7-day allowance. This always sweeps against the fixed, safe remember.lifetime
        // floor instead, so a remembered session can never be deleted before its actual expiry.
        $middleware->prependToGroup('api', CollectStaleSessions::class);
        $middleware->prependToGroup('web', CollectStaleSessions::class);

        // The access log's actor capture (023, research D2): the outer recorder runs before
        // the session exists, so the account a request ARRIVED as is stashed here instead.
        // Append order is group order, so this MUST stay above the EnsureAccountEnabled line
        // below — otherwise a disabled account's 401 would be attributed to nobody, and that
        // is precisely the row an operator investigating that account came for. The `web`
        // group has no such anchor (EnsureAccountEnabled is appended to `api` only), so
        // there it just needs to be appended, which already places it after StartSession.
        $middleware->appendToGroup('api', CaptureAccessLogActor::class);
        $middleware->appendToGroup('web', CaptureAccessLogActor::class);

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
