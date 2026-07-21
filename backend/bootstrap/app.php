<?php

declare(strict_types=1);

use App\Http\Middleware\EnsureAccountEnabled;
use App\Http\Middleware\EnsureRole;
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

        // Live-session revocation (FR-014): appended AFTER statefulApi so the session is
        // started and $request->user() resolves before it runs. A disabled account's next
        // request is refused and its session torn down (research D3).
        $middleware->appendToGroup('api', EnsureAccountEnabled::class);

        // `role:admin` (etc.) gates a route to accounts of at least the named role.
        $middleware->alias(['role' => EnsureRole::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
