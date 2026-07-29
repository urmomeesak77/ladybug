<?php

declare(strict_types=1);

namespace App\Support;

use InvalidArgumentException;

/**
 * Everything one address needs in its <head>, as an immutable value object.
 *
 * There are exactly three ways to obtain one: site() for every generic address,
 * forPost() for a publicly visible meme (added with US1), and fromArray() when it
 * comes back out of the cache. Keeping the generic path down to a SINGLE
 * constructor is what makes FR-010 structural rather than a review item: the home
 * feed, a noindex page, a hidden meme, a 404 and the FR-038 degraded response all
 * emit provably the same bytes, so there is no branch through which a hidden
 * meme's title or image could reach a requester.
 */
class PageMeta {
    /**
     * @param  array<string, mixed>|null  $structuredData  JSON-LD @graph; null for
     *                                                     every non-public address.
     */
    private function __construct(
        public readonly string $title,
        public readonly string $description,
        public readonly string $canonical,
        /** og:type — `article` for a meme permalink, `website` everywhere else. */
        public readonly string $ogType,
        public readonly string $socialTitle,
        public readonly string $socialDescription,
        public readonly string $imageUrl,
        public readonly bool $isLargeImageCard,
        public readonly bool $isIndexable,
        public readonly ?array $structuredData,
    ) {
        // Rich results for a page that asks not to be indexed is a contradiction we
        // refuse to emit, so the invariant is enforced where it cannot be bypassed.
        if ($structuredData !== null && !$isIndexable) {
            throw new InvalidArgumentException('Structured data may not be attached to a non-indexable page.');
        }
    }

    /**
     * The generic metadata: site name, site description, branded image.
     *
     * @param  string  $canonical  absolute, query- and fragment-free
     */
    public static function site(string $canonical, bool $isIndexable): self {
        $name = (string) config('seo.site_name');
        $description = (string) config('seo.site_description');

        return new self(
            title: $name,
            description: $description,
            canonical: $canonical,
            ogType: 'website',
            socialTitle: $name,
            socialDescription: $description,
            imageUrl: self::absoluteUrl((string) config('seo.fallback_image')),
            // The branded logo is square; a large-image card would stretch it (D7).
            isLargeImageCard: false,
            isIndexable: $isIndexable,
            structuredData: null,
        );
    }

    /**
     * Rebuild from a cache entry. Runs the same constructor, so a stale or tampered
     * payload cannot smuggle in a state the invariants forbid.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function fromArray(array $payload): self {
        return new self(
            title: (string) $payload['title'],
            description: (string) $payload['description'],
            canonical: (string) $payload['canonical'],
            ogType: (string) $payload['ogType'],
            socialTitle: (string) $payload['socialTitle'],
            socialDescription: (string) $payload['socialDescription'],
            imageUrl: (string) $payload['imageUrl'],
            isLargeImageCard: (bool) $payload['isLargeImageCard'],
            isIndexable: (bool) $payload['isIndexable'],
            structuredData: $payload['structuredData'] ?? null,
        );
    }

    /**
     * The cache payload. A plain array rather than PHP serialization, so a change
     * to this class never makes an entry written by the previous release unreadable.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array {
        return [
            'title' => $this->title,
            'description' => $this->description,
            'canonical' => $this->canonical,
            'ogType' => $this->ogType,
            'socialTitle' => $this->socialTitle,
            'socialDescription' => $this->socialDescription,
            'imageUrl' => $this->imageUrl,
            'isLargeImageCard' => $this->isLargeImageCard,
            'isIndexable' => $this->isIndexable,
            'structuredData' => $this->structuredData,
        ];
    }

    /**
     * Absolutise a root-relative path against the canonical origin. An already
     * absolute value is returned untouched, so a disk URL can pass through here.
     */
    private static function absoluteUrl(string $path): string {
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        return rtrim((string) config('app.url'), '/') . '/' . ltrim($path, '/');
    }
}
