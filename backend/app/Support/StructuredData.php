<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Trashpost;
use App\Utils\Youtube;

/**
 * The JSON-LD `@graph` a publicly visible meme carries (FR-024–FR-028).
 *
 * Every value the graph shares with the `<head>` is passed IN rather than derived
 * here — the caller is PageMeta::forPost(), which hands over the very strings it
 * is about to write into the og: tags. That is what makes FR-027 hold by
 * construction: there is no second derivation that could drift from the first.
 * Only the fields the tags do not carry (publication date, author, embed id) are
 * read off the row.
 *
 * A non-public meme never reaches here: PageMeta::site() leaves structuredData
 * null, so a hidden page emits no graph at all rather than an empty one (FR-028).
 */
class StructuredData {
    private const CONTEXT = 'https://schema.org';

    /** Composed only from a re-validated id, never from the stored column. */
    private const EMBED_PREFIX = 'https://www.youtube.com/embed/';

    /**
     * research D5. JSON_HEX_TAG is the load-bearing one: it turns `<` and `>` into
     * < / >, so a title containing `</script>` cannot terminate the
     * element it is written into. HEX_AMP/APOS/QUOT close the remaining HTML-
     * significant characters. No htmlspecialchars is applied on top — inside a
     * <script> element the browser does no entity decoding, so entities would
     * corrupt the JSON rather than protect it. UNESCAPED_SLASHES and
     * UNESCAPED_UNICODE keep the URLs and non-ASCII titles readable.
     */
    private const ENCODE_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;

    /**
     * @param  string  $canonical  the meme's own absolute permalink
     * @param  string  $name  the og:title value
     * @param  string  $description  the og:description value
     * @param  string  $imageUrl  the og:image value
     * @return array<string, mixed>
     */
    public static function forPost(
        Trashpost $post,
        string $canonical,
        string $name,
        string $description,
        string $imageUrl,
    ): array {
        return [
            '@context' => self::CONTEXT,
            '@graph' => [
                self::mediaNode($post, $canonical, $name, $description, $imageUrl),
                self::breadcrumbs($name),
            ],
        ];
    }

    /**
     * Render the graph for the `<script type="application/ld+json">` element.
     *
     * @param  array<string, mixed>  $graph
     */
    public static function encode(array $graph): string {
        return (string) json_encode($graph, self::ENCODE_FLAGS);
    }

    /**
     * The node describing the meme itself: an ImageObject, or a VideoObject when
     * the row's own `type` says the meme is a YouTube link (data-model → Trashpost).
     *
     * @return array<string, mixed>
     */
    private static function mediaNode(
        Trashpost $post,
        string $canonical,
        string $name,
        string $description,
        string $imageUrl,
    ): array {
        $published = $post->created_at?->toIso8601String();
        $node = [
            '@type' => $post->type === 'youtube' ? 'VideoObject' : 'ImageObject',
            'url' => $canonical,
            'name' => $name,
            'description' => $description,
        ];

        if ($post->type === 'youtube') {
            $node['thumbnailUrl'] = $imageUrl;
            $node['uploadDate'] = $published;
            // Principle VI: re-derived from the stored column, and simply absent if
            // it no longer parses. Concatenating raw input would put an unvalidated
            // value into an address a crawler and a browser will both follow.
            $id = Youtube::extractId((string) $post->youtube);
            if ($id !== null) {
                $node['embedUrl'] = self::EMBED_PREFIX . $id;
            }

            return $node;
        }

        $node['contentUrl'] = $imageUrl;
        $node['datePublished'] = $published;
        // The author of record is the account name when the upload still has an
        // owner, and the snapshot taken at upload time otherwise (mirrors
        // TrashpostResource). An upload with neither carries no author node at all,
        // rather than one naming nobody.
        $author = $post->user?->name ?? $post->username;
        if ($author !== null && $author !== '') {
            $node['author'] = ['@type' => 'Person', 'name' => $author];
        }

        return $node;
    }

    /**
     * FR-026: the same two-item trail on every meme page — the site, then this
     * meme. The second item carries no `item` URL: it names the page the reader is
     * already on, which schema.org treats as the trail's implicit endpoint.
     *
     * @return array<string, mixed>
     */
    private static function breadcrumbs(string $name): array {
        return [
            '@type' => 'BreadcrumbList',
            'itemListElement' => [
                [
                    '@type' => 'ListItem',
                    'position' => 1,
                    'name' => (string) config('seo.site_name'),
                    'item' => rtrim((string) config('app.url'), '/') . '/',
                ],
                [
                    '@type' => 'ListItem',
                    'position' => 2,
                    'name' => $name,
                ],
            ],
        ];
    }
}
