<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Trashpost;
use App\Services\TrashpostImageService;
use Illuminate\Support\Collection;

/**
 * The server-rendered contents of the SPA's root node.
 *
 * This exists for crawlers, not for browsers. Everything the site shows lives
 * behind `createRoot().render()` (frontend/src/main.tsx), so until React runs, the
 * document is `<div id="root"></div>` and carries no text and — the part that
 * actually cost us — no links. Google reached the newest ten memes and nothing
 * else: the feed appends by IntersectionObserver, which a crawler never triggers
 * by scrolling, and the `<a>` page break only enters the DOM at 200 entries
 * (frontend/src/lib/pagination.ts). Every other meme was discoverable only through
 * the sitemap, with no internal link pointing at it, which is the population Search
 * Console reports as "Crawled - currently not indexed".
 *
 * So the markup below is a real, walkable archive: each feed page links its ten
 * memes by title and links on to the next page, which makes the whole corpus
 * reachable in ~263 hops without executing a line of JavaScript.
 *
 * React REPLACES this the moment it mounts, so nothing here is styled or
 * interactive and none of it is a second implementation of the feed — it is the
 * same content the SPA is about to render, which is what keeps it the opposite of
 * cloaking. It is deliberately NOT hidden: markup a crawler sees and a visitor
 * cannot is exactly the thing that earns a manual action.
 *
 * Escaping is final here, as it is in ShellRenderer, and for the same reason: this
 * string is injected into the document verbatim.
 */
class ShellBody {
    /**
     * One meme's permalink: its title, its image, and who posted it when.
     *
     * Only PageMetaService calls this, and only for a meme that has already passed
     * the visibility test — a hidden or purged meme gets the empty body every other
     * address gets, so no title of a non-public meme can reach a requester (FR-010).
     */
    public static function forPost(Trashpost $post): string {
        $label = self::label($post);
        $parts = ['<h1>' . self::escape($label) . '</h1>'];

        $image = app(TrashpostImageService::class)->imageData($post)['default'];
        if ($image !== null) {
            $parts[] = self::image($image, $label);
        }

        $parts[] = self::byline($post);

        return '<article>' . implode('', array_filter($parts)) . '</article>';
    }

    /**
     * One page of the feed: every meme linked by title, then the link onwards.
     *
     * $nextCursor is the hash the next page starts after, or null on the last page
     * — the caller decides, because only it knows whether more rows existed.
     *
     * @param  Collection<int, Trashpost>  $posts
     */
    public static function forFeed(Collection $posts, ?string $nextCursor): string {
        if ($posts->isEmpty()) {
            return '';
        }

        $items = $posts->map(static fn (Trashpost $post): string => self::feedItem($post))->implode('');
        $html = '<ul>' . $items . '</ul>';

        if ($nextCursor !== null) {
            // A plain <a>, not rel=next: Google stopped using rel=next/prev for
            // indexing in 2019, and an ordinary link is what actually gets followed.
            $html .= '<a href="/?after=' . self::escape($nextCursor) . '">Older memes</a>';
        }

        return $html;
    }

    /** One feed entry. The title is the anchor text — that is the whole point. */
    private static function feedItem(Trashpost $post): string {
        $label = self::label($post);
        $link = '<a href="/posts/' . self::escape((string) $post->hash) . '">' . self::escape($label) . '</a>';

        $image = app(TrashpostImageService::class)->imageData($post)['default'];

        return '<li>' . $link . ($image === null ? '' : self::image($image, $label)) . '</li>';
    }

    /**
     * The uploader and the publication date, matching the author and datePublished
     * the JSON-LD graph already asserts (StructuredData::forPost) so the rendered
     * page and the structured data cannot disagree.
     */
    private static function byline(Trashpost $post): string {
        $author = $post->user?->name ?? $post->username;
        $published = $post->created_at;
        if ($published === null) {
            return '';
        }

        $time = '<time datetime="' . self::escape($published->toDateString()) . '">'
            . self::escape($published->format('j F Y')) . '</time>';

        return '<p>' . ($author === null || $author === '' ? 'Posted ' : 'Posted by '
            . self::escape($author) . ' ') . 'on ' . $time . '</p>';
    }

    private static function image(string $url, string $label): string {
        // `loading="lazy"` is deliberately absent: this markup is replaced within
        // milliseconds, and a lazy image in a node about to be discarded is a
        // fetch the browser may start and then throw away.
        return '<img src="' . self::escape($url) . '" alt="' . self::escape($label) . '">';
    }

    /** The meme's title, or the same fallback PageMeta and the SPA feed both use. */
    private static function label(Trashpost $post): string {
        $title = trim((string) $post->title);

        return $title === '' ? (string) config('seo.untitled_label') : $title;
    }

    private static function escape(string $value): string {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
