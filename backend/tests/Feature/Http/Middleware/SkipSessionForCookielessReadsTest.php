<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The crawler-facing web routes (shell, robots, sitemaps, unfurl image) used to INSERT a
 * `sessions` row for every cookieless hit — one per crawler request, each kept until GC.
 * A request that arrives without a session cookie is anonymous by definition, so nothing it
 * could put in a session is worth a row; these run through the real `web` group.
 */
final class SkipSessionForCookielessReadsTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        // The shell is a build artifact (`vite build` output), absent on a clean checkout and
        // so in CI; the committed fixture keeps these from depending on whether anyone has
        // built the frontend. Same fixture ShellControllerTest uses.
        config(['seo.shell_path' => base_path('tests/fixtures/spa-shell.html')]);
        Config::set('services.google', [
            'client_id' => 'client-id',
            'client_secret' => 'client-secret',
            'redirect_uri' => 'http://localhost/api/auth/google/callback',
            'authorize_url' => 'https://accounts.google.com/o/oauth2/v2/auth',
            'token_url' => 'https://oauth2.googleapis.com/token',
        ]);
    }

    private function sessionRows(): int {
        return DB::table((string) config('session.table'))->count();
    }

    public function test_a_cookieless_robots_request_stores_no_session(): void {
        $this->get('/robots.txt')->assertOk();

        $this->assertSame(0, $this->sessionRows());
    }

    public function test_a_cookieless_shell_request_stores_no_session(): void {
        $this->get('/login')->assertOk();

        $this->assertSame(0, $this->sessionRows());
    }

    public function test_a_request_carrying_a_session_cookie_still_stores_its_session(): void {
        // A returning browser keeps the ordinary behaviour, so a signed-in visitor's session
        // is read, refreshed and attributed exactly as before.
        $this->withCookie((string) config('session.cookie'), 'an-existing-session-id-0123456789abcdef')
            ->get('/login')
            ->assertOk();

        $this->assertSame(1, $this->sessionRows());
    }

    public function test_the_csrf_cookie_route_keeps_its_session_for_a_cookieless_browser(): void {
        // The token it hands out is checked against the stored session on the next POST;
        // an unstored one would turn a fresh browser's first sign-in into a 419.
        $this->get('/sanctum/csrf-cookie')->assertNoContent();

        $this->assertSame(1, $this->sessionRows());
    }

    public function test_the_google_redirect_keeps_its_session_for_a_cookieless_browser(): void {
        // A fresh browser following a direct link to the sign-in door must still get the
        // OAuth state stored, or the callback would fail its CSRF check on every attempt.
        $this->get('/api/auth/google/redirect')->assertRedirect();

        $this->assertSame(1, $this->sessionRows());
    }
}
