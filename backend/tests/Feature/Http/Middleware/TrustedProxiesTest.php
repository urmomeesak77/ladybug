<?php

declare(strict_types=1);

namespace Tests\Feature\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * The production stack sits behind the edge nginx, which terminates TLS and forwards
 * over plain HTTP. Without trusted proxies Laravel believes the request is insecure and
 * builds http:// URLs -- which breaks signed e-mail verification links (they are signed
 * over the URL, so a scheme mismatch invalidates the signature) and every media URL,
 * since the public disk derives its URL from APP_URL.
 */
final class TrustedProxiesTest extends TestCase {
    private function defineSchemeProbe(): void {
        Route::get('/_probe/scheme', static fn (Request $request): array => [
            'secure' => $request->isSecure(),
            'scheme' => $request->getScheme(),
            'ip' => $request->ip(),
        ]);
    }

    public function test_forwarded_proto_header_marks_the_request_secure(): void {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme', ['X-Forwarded-Proto' => 'https'])
            ->assertOk()
            ->assertJson(['secure' => true, 'scheme' => 'https']);
    }

    public function test_forwarded_for_header_resolves_the_real_client_ip(): void {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme', ['X-Forwarded-For' => '203.0.113.7'])
            ->assertOk()
            ->assertJson(['ip' => '203.0.113.7']);
    }

    public function test_a_request_without_forwarded_headers_stays_insecure(): void {
        $this->defineSchemeProbe();

        $this->get('/_probe/scheme')
            ->assertOk()
            ->assertJson(['secure' => false, 'scheme' => 'http']);
    }
}
