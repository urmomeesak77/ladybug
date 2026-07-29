<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\SpaRoutes;
use Illuminate\Http\Response;

/**
 * Serves /robots.txt.
 *
 * The body is GENERATED from SpaRoutes::disallowedPaths() — the same table that
 * decides which addresses carry <meta name="robots" content="noindex"> — so FR-012
 * and FR-021 cannot drift apart: adding a private SPA route updates both surfaces
 * at once (research D9).
 *
 * Deliberately NOT disallowed (FR-023): /storage/, so image crawlers can fetch meme
 * media and og:image keeps its validation fetch, and /assets/, so rendering crawlers
 * are not served a degraded page.
 */
class RobotsController extends Controller {
    public function show(): Response {
        $lines = ['User-agent: *'];
        foreach (SpaRoutes::disallowedPaths() as $path) {
            $lines[] = "Disallow: {$path}";
        }
        // Absolutised from APP_URL rather than hard-coded, so the dev and e2e
        // origins name their own listing instead of pointing crawlers at production.
        $lines[] = '';
        $lines[] = 'Sitemap: ' . rtrim((string) config('app.url'), '/') . '/sitemap.xml';

        return response(implode("\n", $lines) . "\n")
            // The regression this guards: the address used to answer 200 text/html
            // with the SPA shell, which no crawler reads as robots.txt at all.
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=' . (int) config('seo.cache_ttl'));
    }
}
