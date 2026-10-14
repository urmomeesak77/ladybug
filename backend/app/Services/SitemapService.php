<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\SpaRoutes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * Renders the crawler-facing address listing: a sitemap index plus its children.
 *
 * Membership is Trashpost::publiclyVisible() — the same scope the public feed reads
 * through — so the archive a crawler is offered can never drift from the archive a
 * visitor can browse (FR-017).
 *
 * The rendered XML is cached, not the row set (FR-020): a repeated retrieval inside
 * the interval performs no query at all (AS2.6). Entries are deliberately not
 * invalidated on a moderation transition — for the listing, the refresh interval IS
 * the contract (AS2.5), unlike a permalink's metadata (FR-040).
 */
class SitemapService {
    /**
     * Cache namespace. The `v1` segment is a version: bumping it drops every entry
     * at once on a deploy that changes the emitted XML, rather than leaving crawlers
     * an hour of mixed-vintage children.
     */
    private const KEY_PREFIX = 'seo:sitemap:v1:';

    private const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";

    private const NAMESPACE_URI = 'http://www.sitemaps.org/schemas/sitemap/0.9';

    /**
     * The sitemap index. Always an index, never a flat urlset — the response shape
     * is the same from the first meme onward, so there is no growth transition to
     * get wrong. With no visible memes it lists the static child alone and stays
     * schema-valid (spec edge case "Empty site").
     */
    public function index(): string {
        $key = self::KEY_PREFIX . 'index';
        $cached = Cache::get($key);
        if (is_string($cached)) {
            return $cached;
        }

        $xml = self::renderIndex(self::pageCount());
        Cache::put($key, $xml, self::ttl());

        return $xml;
    }

    /**
     * The public static addresses — today the home feed alone. Driven by the same
     * predicate as the per-page robots tag, so a noindex address cannot be listed.
     */
    public function staticUrls(): string {
        $key = self::KEY_PREFIX . 'static';
        $cached = Cache::get($key);
        if (is_string($cached)) {
            return $cached;
        }

        $body = '';
        foreach (SpaRoutes::indexableStaticPaths() as $path) {
            $body .= '  <url><loc>' . self::url($path) . "</loc></url>\n";
        }
        $xml = self::urlset($body);
        Cache::put($key, $xml, self::ttl());

        return $xml;
    }

    /**
     * One child of the index, `1`-based. Null when the page holds nothing — which is
     * how an out-of-range page becomes a 404 rather than an empty urlset.
     */
    public function postsPage(int $page): ?string {
        if ($page < 1) {
            return null;
        }

        $key = self::KEY_PREFIX . "posts:{$page}";
        $cached = Cache::get($key);
        if (is_string($cached)) {
            return $cached;
        }

        // Checked against the cached page count BEFORE any walk: an out-of-range answer is
        // null and therefore never cached, so without this every such hit — any number a
        // visitor cares to type — walked the whole archive to find out it had run out.
        if ($page > self::pageCount()) {
            return null;
        }

        $posts = self::pageRows($page);
        if ($posts->isEmpty()) {
            return null;
        }

        $xml = self::renderPosts($posts);
        Cache::put($key, $xml, self::ttl());

        return $xml;
    }

    /**
     * How many post children the index lists, cached on the listing's own interval so the
     * index and the range check in postsPage() cannot disagree about where the archive ends.
     */
    private static function pageCount(): int {
        $key = self::KEY_PREFIX . 'pages';
        $cached = Cache::get($key);
        if (is_int($cached)) {
            return $cached;
        }

        $pages = (int) ceil(Trashpost::publiclyVisible()->count() / self::chunk());
        Cache::put($key, $pages, self::ttl());

        return $pages;
    }

    /**
     * The rows of one page, reached by walking the keyset forward one chunk at a
     * time. Newest-first, so a crawler that samples only the first child still sees
     * the freshest memes, and the last page costs the same as the first — which
     * neither offset() nor a chunk() callback would give us (Principle II).
     *
     * Each earlier chunk is crossed by reading only its LAST id (an index-only probe),
     * never its rows: hydrating 50,000 models per chunk just to read the final one's id
     * was the most memory any request on the site could ask for.
     *
     * @return Collection<int, object>
     */
    private static function pageRows(int $page): Collection {
        $chunk = self::chunk();
        $lastId = null;
        for ($walked = 1; $walked < $page; $walked++) {
            $lastId = self::chunkBoundary($lastId, $chunk);
            if ($lastId === null) {
                return new Collection();
            }
        }

        return self::chunkBefore($lastId, $chunk);
    }

    /** The id the chunk after $lastId ends on, or null when that chunk is not full. */
    private static function chunkBoundary(?int $lastId, int $chunk): ?int {
        $id = self::visibleBefore($lastId)->offset($chunk - 1)->limit(1)->value('id');

        return $id === null ? null : (int) $id;
    }

    /**
     * One chunk of publicly visible memes older than $lastId, newest first, as plain rows
     * rather than models — renderPosts() needs three columns, not Eloquent.
     *
     * @return Collection<int, object>
     */
    private static function chunkBefore(?int $lastId, int $chunk): Collection {
        return self::visibleBefore($lastId)->limit($chunk)->toBase()->get(['id', 'hash', 'created_at']);
    }

    /** @return Builder<Trashpost> */
    private static function visibleBefore(?int $lastId): Builder {
        $query = Trashpost::publiclyVisible()->orderByDesc('id');
        if ($lastId !== null) {
            $query->where('id', '<', $lastId);
        }

        return $query;
    }

    private static function renderIndex(int $pages): string {
        $children = ['/sitemaps/static.xml'];
        for ($page = 1; $page <= $pages; $page++) {
            $children[] = "/sitemaps/posts-{$page}.xml";
        }

        $body = '';
        foreach ($children as $path) {
            $body .= '  <sitemap><loc>' . self::url($path) . "</loc></sitemap>\n";
        }

        return self::DECLARATION
            . '<sitemapindex xmlns="' . self::NAMESPACE_URI . "\">\n"
            . $body
            . "</sitemapindex>\n";
    }

    /**
     * @param  Collection<int, object>  $posts
     */
    private static function renderPosts(Collection $posts): string {
        $body = '';
        foreach ($posts as $post) {
            // <lastmod> is created_at: a meme's media and title are immutable once
            // uploaded, so there is no separate modification time (FR-018).
            $body .= "  <url>\n"
                . '    <loc>' . self::url("/posts/{$post->hash}") . "</loc>\n"
                . '    <lastmod>' . Carbon::parse($post->created_at)->toAtomString() . "</lastmod>\n"
                . "  </url>\n";
        }

        return self::urlset($body);
    }

    private static function urlset(string $body): string {
        return self::DECLARATION
            . '<urlset xmlns="' . self::NAMESPACE_URI . "\">\n"
            . $body
            . "</urlset>\n";
    }

    /** Absolute, on the canonical origin, escaped for its XML text position. */
    private static function url(string $path): string {
        $absolute = rtrim((string) config('app.url'), '/') . $path;

        return htmlspecialchars($absolute, ENT_QUOTES | ENT_XML1 | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function chunk(): int {
        return (int) config('seo.sitemap_chunk');
    }

    private static function ttl(): int {
        return (int) config('seo.sitemap_cache_ttl');
    }
}
