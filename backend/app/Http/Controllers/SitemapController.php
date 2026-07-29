<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\SitemapService;
use Illuminate\Http\Response;

/**
 * Serves the sitemap index and its children.
 *
 * These routes are registered above the shell catch-all (routes/web.php), which is
 * the whole of what keeps the SPA from swallowing them (FR-022).
 */
class SitemapController extends Controller {
    /** `1`-based page numbers only: no zero, no sign, no leading zero. */
    private const PAGE_PATTERN = '/^[1-9][0-9]*$/';

    public function __construct(
        private readonly SitemapService $sitemap = new SitemapService(),
    ) {
    }

    public function index(): Response {
        return self::xml($this->sitemap->index());
    }

    public function static(): Response {
        return self::xml($this->sitemap->staticUrls());
    }

    /**
     * A child listing. The page arrives as a string because it is part of a
     * filename, so a non-numeric value is a real possibility rather than a
     * theoretical one — and is a 404, not a cast to zero.
     */
    public function posts(string $page): Response {
        if (preg_match(self::PAGE_PATTERN, $page) !== 1) {
            abort(404);
        }

        $xml = $this->sitemap->postsPage((int) $page);
        if ($xml === null) {
            abort(404);
        }

        return self::xml($xml);
    }

    private static function xml(string $body): Response {
        return response($body)
            ->header('Content-Type', 'application/xml; charset=UTF-8')
            // Public and identical for every requester: nothing about the caller is
            // read anywhere in the listing, so any cache may hold one copy for the
            // refresh interval FR-020 fixes.
            ->header('Cache-Control', 'public, max-age=' . (int) config('seo.cache_ttl'));
    }
}
