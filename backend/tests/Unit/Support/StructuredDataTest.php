<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Models\Trashpost;
use App\Support\StructuredData;
use Tests\TestCase;

/**
 * The JSON-LD graph a publicly visible meme carries (US5).
 *
 * Two properties matter beyond the shape. First, FR-027: every value here is one
 * the og: tags already carry, so a validator and an unfurl card can never
 * disagree. Second, Principle VI: the embed id is re-derived from the stored
 * column rather than trusted, and the encoding makes `</script>` inexpressible
 * without any HTML escaping layered on top.
 */
final class StructuredDataTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.site_name' => 'online-trash',
            'seo.site_description' => 'An endless feed of memes.',
        ]);
    }

    /**
     * An unsaved model is enough: nothing here queries, and keeping the suite off
     * the database is what makes it a unit test.
     */
    private function makePost(array $attributes = []): Trashpost {
        $post = new Trashpost();
        $post->forceFill(array_merge([
            'hash' => 'aB3dEf7GhJ',
            'title' => 'Cat on a roomba',
            'type' => 'image',
            'file' => 'aB3dEf7GhJ.webp',
            'youtube' => null,
            'username' => 'Some uploader',
            'created_at' => '2026-07-01 12:34:56',
        ], $attributes));

        return $post;
    }

    /**
     * @return array<string, mixed>
     */
    private function graphFor(Trashpost $post, string $name = 'Cat on a roomba', string $description = 'Cat on a roomba'): array {
        return StructuredData::forPost(
            post: $post,
            canonical: 'https://online-trash.com/posts/' . $post->hash,
            name: $name,
            description: $description,
            imageUrl: 'https://online-trash.com/storage/image/trash/800/a/aB3dEf7GhJ.webp',
        );
    }

    public function test_an_image_meme_yields_an_image_object(): void {
        $node = $this->graphFor($this->makePost())['@graph'][0];

        $this->assertSame('ImageObject', $node['@type']);
        $this->assertSame('https://online-trash.com/posts/aB3dEf7GhJ', $node['url']);
        $this->assertSame('https://online-trash.com/storage/image/trash/800/a/aB3dEf7GhJ.webp', $node['contentUrl']);
        $this->assertSame('Cat on a roomba', $node['name']);
        $this->assertSame('Cat on a roomba', $node['description']);
    }

    public function test_an_image_meme_carries_its_publication_date_in_iso_8601(): void {
        $node = $this->graphFor($this->makePost())['@graph'][0];

        $this->assertSame('2026-07-01T12:34:56+00:00', $node['datePublished']);
    }

    public function test_an_image_meme_names_its_author_as_a_person(): void {
        $node = $this->graphFor($this->makePost())['@graph'][0];

        $this->assertSame(['@type' => 'Person', 'name' => 'Some uploader'], $node['author']);
    }

    /** An unowned, unnamed upload simply has no author node rather than an empty one. */
    public function test_a_meme_with_no_author_omits_the_person_node(): void {
        $node = $this->graphFor($this->makePost(['username' => null]))['@graph'][0];

        $this->assertArrayNotHasKey('author', $node);
    }

    public function test_a_youtube_meme_yields_a_video_object(): void {
        $post = $this->makePost(['type' => 'youtube', 'file' => null, 'youtube' => 'dQw4w9WgXcQ']);

        $node = $this->graphFor($post)['@graph'][0];

        $this->assertSame('VideoObject', $node['@type']);
        $this->assertSame('https://online-trash.com/storage/image/trash/800/a/aB3dEf7GhJ.webp', $node['thumbnailUrl']);
        $this->assertSame('2026-07-01T12:34:56+00:00', $node['uploadDate']);
        $this->assertArrayNotHasKey('contentUrl', $node);
    }

    /** The id is re-derived, never taken as stored — a full watch URL still resolves. */
    public function test_a_youtube_embed_url_is_composed_from_a_revalidated_id(): void {
        $post = $this->makePost([
            'type' => 'youtube',
            'file' => null,
            'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
        ]);

        $node = $this->graphFor($post)['@graph'][0];

        $this->assertSame('https://www.youtube.com/embed/dQw4w9WgXcQ', $node['embedUrl']);
    }

    /**
     * Principle VI: a stored value that no longer parses is dropped, never
     * concatenated into a URL. Emitting `embed/<raw>` would put unvalidated input
     * into an address a crawler or a browser will follow.
     */
    public function test_a_youtube_value_that_no_longer_parses_omits_the_embed_url(): void {
        $post = $this->makePost([
            'type' => 'youtube',
            'file' => null,
            'youtube' => 'not a video reference at all',
        ]);

        $node = $this->graphFor($post)['@graph'][0];

        $this->assertSame('VideoObject', $node['@type']);
        $this->assertArrayNotHasKey('embedUrl', $node);
    }

    /** FR-026: every graph, whatever the media, carries the same two-item trail. */
    public function test_every_graph_carries_a_two_item_breadcrumb_list(): void {
        $posts = [
            $this->makePost(),
            $this->makePost(['type' => 'youtube', 'file' => null, 'youtube' => 'dQw4w9WgXcQ']),
        ];

        foreach ($posts as $post) {
            $graph = $this->graphFor($post);
            $trail = $graph['@graph'][1];

            $this->assertSame('BreadcrumbList', $trail['@type']);
            $this->assertCount(2, $trail['itemListElement']);
            $this->assertSame(
                ['@type' => 'ListItem', 'position' => 1, 'name' => 'online-trash', 'item' => 'https://online-trash.com/'],
                $trail['itemListElement'][0],
            );
            $this->assertSame(
                ['@type' => 'ListItem', 'position' => 2, 'name' => 'Cat on a roomba'],
                $trail['itemListElement'][1],
            );
        }
    }

    public function test_the_graph_declares_the_schema_org_context(): void {
        $this->assertSame('https://schema.org', $this->graphFor($this->makePost())['@context']);
    }

    /**
     * The description is whatever the og: tags carry, so an untitled meme's site
     * copy arrives here already resolved rather than being decided a second time.
     */
    public function test_the_description_is_the_one_the_social_tags_carry(): void {
        $post = $this->makePost(['title' => null, 'type' => 'youtube', 'file' => null, 'youtube' => 'dQw4w9WgXcQ']);

        $node = $this->graphFor($post, 'Untitled meme', 'An endless feed of memes.')['@graph'][0];

        $this->assertSame('Untitled meme', $node['name']);
        $this->assertSame('An endless feed of memes.', $node['description']);
    }

    /**
     * research D5: the six flags make a closing script tag inexpressible, so the
     * block cannot be broken out of. No htmlspecialchars is layered on top —
     * inside a <script> element that would corrupt the JSON rather than protect it.
     */
    public function test_a_closing_script_tag_in_a_title_cannot_break_out_of_the_block(): void {
        $json = StructuredData::encode($this->graphFor($this->makePost(), '</script><script>alert(1)</script>'));

        $this->assertStringNotContainsString('</script>', $json);
        $this->assertStringNotContainsString('<script', $json);
        $this->assertSame('</script><script>alert(1)</script>', json_decode($json, true)['@graph'][0]['name']);
    }

    /**
     * Asserted on the VALUES, not on the whole document: `"` is JSON's own string
     * delimiter and can never be absent from valid JSON. What must hold is that no
     * HTML-significant character survives inside a value, where it could otherwise
     * be read as markup by whatever parses the surrounding element.
     */
    public function test_encoding_escapes_the_html_significant_characters(): void {
        $title = 'Tom & Jerry\'s "big" <day>';

        $json = StructuredData::encode($this->graphFor($this->makePost(), $title));

        $this->assertStringNotContainsString($title, $json);
        // The escape sequences the six flags produce. Built with sprintf rather
        // than written out, so the expectation is derived from the character under
        // test instead of hand-copied from the output it is meant to check.
        foreach (['&', "'", '"', '<', '>'] as $character) {
            $this->assertStringContainsString(
                sprintf('\u%04X', mb_ord($character)),
                $json,
                $character,
            );
        }
        $this->assertSame($title, json_decode($json, true)['@graph'][0]['name']);
    }

    /** Slashes stay readable and non-ASCII stays itself — the graph is full of URLs. */
    public function test_encoding_leaves_slashes_and_unicode_unescaped(): void {
        $json = StructuredData::encode($this->graphFor($this->makePost(), 'Ämpärin täysi rojua'));

        $this->assertStringContainsString('https://online-trash.com/posts/aB3dEf7GhJ', $json);
        $this->assertStringContainsString('Ämpärin täysi rojua', $json);
    }
}
