<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\PageMeta;
use App\Support\SpaRoutes;
use Illuminate\Support\Facades\Cache;

/**
 * Resolves one address to the metadata its <head> carries, and caches the result.
 *
 * This is the only layer in the feature that reads a meme row, which makes it the
 * only place FR-010 can be breached — so the non-public branch returns the same
 * PageMeta::site() object every other generic address gets, with no value from the
 * row reaching it. Nothing about the requester is consulted anywhere here; that is
 * what makes a single cache entry per address correct rather than a leak (FR-039).
 */
class PageMetaService {
    /**
     * The cache namespace. The `v1` segment is a version: bumping it invalidates
     * every entry at once on a deploy that changes the emitted tag set, instead of
     * leaving the site an hour of mixed-vintage responses.
     */
    private const KEY_PREFIX = 'seo:meta:v1:';

    /** Anchored so a malformed identifier never becomes a query (Constitution V). */
    private const POST_PATH_PATTERN = '#^/posts/([A-Za-z0-9_-]{10})$#';

    /**
     * The metadata for a leading-slash path, from the cache when it is warm.
     */
    public function forPath(string $path): PageMeta {
        $key = self::key($path);
        $payload = Cache::get($key);
        if (is_array($payload)) {
            return PageMeta::fromArray($payload);
        }

        // Written back as a plain array rather than a serialized object, so an entry
        // survives a release that changes the class (PageMeta::toArray/fromArray).
        $meta = $this->resolve($path);
        Cache::put($key, $meta->toArray(), (int) config('seo.cache_ttl'));

        return $meta;
    }

    /**
     * Drop one meme's entry. Called from every visibility transition, so a
     * deactivated meme's permalink degrades on the very next request (FR-040).
     */
    public function forget(string $hash): void {
        Cache::forget(self::key("/posts/{$hash}"));
    }

    /**
     * Build the metadata for an address that is not in the cache.
     */
    private function resolve(string $path): PageMeta {
        if (preg_match(self::POST_PATH_PATTERN, $path, $matches) !== 1) {
            return PageMeta::site(self::canonical($path), SpaRoutes::isIndexable($path));
        }

        $post = $this->findVisiblePost($matches[1]);
        if ($post !== null) {
            return PageMeta::forPost($post);
        }

        // A permalink whose meme is not public is demoted to noindex HERE, because
        // SpaRoutes answers for the address class only and cannot see the row
        // (FR-011). A hidden meme, a purged one and a never-existing hash are all
        // this same object — indistinguishable by design (FR-010); only the status
        // code separates them, and US4 decides that from its own lookup.
        return PageMeta::site(self::canonical($path), isIndexable: false);
    }

    /**
     * The meme this hash names, if it is publicly visible. The test mirrors
     * TrashpostService::findViewableByHash and the Trashpost::publiclyVisible
     * scope: activated and not trashed.
     */
    private function findVisiblePost(string $hash): ?Trashpost {
        // withTrashed so a soft-deleted row is still found: US4 needs to tell a
        // hidden meme (200) apart from one that never existed (404).
        $post = Trashpost::withTrashed()->with('user')->where('hash', $hash)->first();
        if ($post === null || $post->activated_at === null || $post->trashed()) {
            return null;
        }

        return $post;
    }

    private static function key(string $path): string {
        // sha1 of the path alone: it keeps the key a fixed, store-safe length, and
        // two distinct addresses cannot land on one entry. No requester identity
        // goes into it, because none is ever read (FR-039).
        return self::KEY_PREFIX . sha1($path);
    }

    /** Absolute, on the canonical origin. Query and fragment are already absent. */
    private static function canonical(string $path): string {
        return rtrim((string) config('app.url'), '/') . $path;
    }
}
