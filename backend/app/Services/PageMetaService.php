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
     * Records already read on this instance, keyed by path.
     *
     * This is a CONSISTENCY guard, not just a saved cache read. The metadata and
     * the status are two answers off one record, and a caller asks for them in two
     * calls; without the memo a moderation transition landing between those calls
     * would invalidate the entry mid-request, and the second call would re-resolve
     * against the changed row — serving a body describing a public meme under the
     * 404 of a purged one. Nothing may resolve an address twice in one request.
     *
     * The container hands out a new instance per resolution, so the memo lives
     * exactly one request and can never outlive the entry it mirrors.
     *
     * @var array<string, array<string, mixed>>
     */
    private array $resolved = [];

    /**
     * The metadata for a leading-slash path, from the cache when it is warm.
     */
    public function forPath(string $path): PageMeta {
        return PageMeta::fromArray($this->entry($path));
    }

    /**
     * The HTTP status this address answers with (US4).
     *
     * For a permalink this is the one question the address table cannot answer: a
     * pending or soft-deleted meme is still a page (200), while a purged hash and
     * one that never existed are both genuinely missing (404). Only the row lookup
     * separates them, and it lives here.
     */
    public function statusFor(string $path): int {
        return (int) $this->entry($path)['status'];
    }

    /**
     * Drop one meme's entry. Called from every visibility transition, so a
     * deactivated meme's permalink degrades on the very next request (FR-040).
     */
    public function forget(string $hash): void {
        $path = "/posts/{$hash}";
        Cache::forget(self::key($path));
        // The memo mirrors the entry, so it has to go with it — otherwise an
        // instance that resolved this address before the transition would keep
        // answering from the pre-transition record for the rest of the request.
        unset($this->resolved[$path]);
    }

    /**
     * The cached record for one address: the serialized PageMeta plus the status the
     * shell answers with.
     *
     * Both are decided by the same row lookup, so they are cached together — asking
     * for the status must never cost a second visit to the database, which is what
     * keeps the warm path at zero queries (SC-011).
     *
     * @return array<string, mixed>
     */
    private function entry(string $path): array {
        if (array_key_exists($path, $this->resolved)) {
            return $this->resolved[$path];
        }

        $key = self::key($path);
        $payload = Cache::get($key);
        // An entry written by a release that predates the status key is treated as a
        // miss rather than trusted with a default, so a deploy can never answer 200
        // for an address that no longer has a row.
        if (is_array($payload) && array_key_exists('status', $payload)) {
            return $this->resolved[$path] = $payload;
        }

        // Written back as a plain array rather than a serialized object, so an entry
        // survives a release that changes the class (PageMeta::toArray/fromArray).
        $payload = $this->resolve($path);
        Cache::put($key, $payload, (int) config('seo.cache_ttl'));

        return $this->resolved[$path] = $payload;
    }

    /**
     * Build the record for an address that is not in the cache.
     *
     * @return array<string, mixed>
     */
    private function resolve(string $path): array {
        if (preg_match(self::POST_PATH_PATTERN, $path, $matches) !== 1) {
            $meta = PageMeta::site(self::canonicalFor($path), SpaRoutes::isIndexable($path));

            return $meta->toArray() + ['status' => SpaRoutes::match($path) === null ? 404 : 200];
        }

        // withTrashed so a soft-deleted row is still found: a hidden meme (200) has
        // to be distinguishable from one that never existed (404).
        $post = Trashpost::withTrashed()->with('user')->where('hash', $matches[1])->first();
        if ($post !== null && $post->activated_at !== null && !$post->trashed()) {
            return PageMeta::forPost($post)->toArray() + ['status' => 200];
        }

        // A permalink whose meme is not public is demoted to noindex HERE, because
        // SpaRoutes answers for the address class only and cannot see the row
        // (FR-011). A hidden meme, a purged one and a never-existing hash all get
        // this same object — indistinguishable by design (FR-010). The status is the
        // ONLY thing that separates them, and it leaks nothing a requester holding
        // the hash does not already know: whether the address is a page at all.
        return PageMeta::site(self::canonicalFor($path), isIndexable: false)->toArray()
            + ['status' => $post === null ? 404 : 200];
    }

    private static function key(string $path): string {
        // sha1 of the path alone: it keeps the key a fixed, store-safe length, and
        // two distinct addresses cannot land on one entry. No requester identity
        // goes into it, because none is ever read (FR-039).
        return self::KEY_PREFIX . sha1($path);
    }

    /**
     * Absolute, on the canonical origin. Query and fragment are already absent.
     *
     * Public because ShellController needs it for the FR-038 degraded response,
     * which by definition cannot go through an instance of this class. Static and
     * pure, so it stays available even when resolution itself is what failed.
     */
    public static function canonicalFor(string $path): string {
        return rtrim((string) config('app.url'), '/') . $path;
    }
}
