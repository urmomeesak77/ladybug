<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Models\Trashpost;
use App\Support\PageMeta;
use App\Support\ShellRenderer;
use Tests\TestCase;

final class ShellRendererTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.site_name' => 'online-trash',
            'seo.site_description' => 'An endless feed of memes.',
            'seo.fallback_image' => '/logo-light.png',
        ]);
    }

    private function template(): string {
        return (string) file_get_contents(base_path('tests/fixtures/spa-shell.html'));
    }

    private function meta(bool $isIndexable = true): PageMeta {
        return PageMeta::site('https://online-trash.com/', $isIndexable);
    }

    /**
     * A site-level PageMeta whose text fields all carry the given hostile value, so
     * one vector exercises every attribute position at once.
     */
    private function metaTitled(string $title): PageMeta {
        config(['seo.site_name' => $title, 'seo.site_description' => $title]);

        return PageMeta::site('https://online-trash.com/', isIndexable: true);
    }

    public function test_the_template_title_is_replaced_not_duplicated(): void {
        $html = ShellRenderer::render($this->template(), $this->meta());

        $this->assertSame(1, substr_count($html, '<title>'));
        $this->assertStringContainsString('<title>online-trash</title>', $html);
    }

    public function test_the_injected_block_sits_immediately_before_the_head_close(): void {
        $html = ShellRenderer::render($this->template(), $this->meta());

        $head = substr($html, 0, (int) strpos($html, '</head>'));
        $this->assertStringEndsWith(
            '<meta name="twitter:image" content="https://online-trash.com/logo-light.png">',
            rtrim($head),
        );
    }

    /**
     * FR-009: the served document below </head> is byte-identical to the built
     * shell, so the SPA boots exactly as it does today — same root node, same
     * hashed asset tag, no extra round trip.
     */
    public function test_everything_below_the_head_close_is_byte_identical(): void {
        $template = $this->template();
        $html = ShellRenderer::render($template, $this->meta());

        $this->assertSame(
            substr($template, (int) strpos($template, '</head>')),
            substr($html, (int) strpos($html, '</head>')),
        );
    }

    public function test_the_generic_head_block_carries_the_full_tag_set(): void {
        $html = ShellRenderer::render($this->template(), $this->meta());

        foreach ([
            '<meta name="description" content="An endless feed of memes.">',
            '<link rel="canonical" href="https://online-trash.com/">',
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="online-trash">',
            '<meta property="og:url" content="https://online-trash.com/">',
            '<meta property="og:title" content="online-trash">',
            '<meta property="og:description" content="An endless feed of memes.">',
            '<meta property="og:image" content="https://online-trash.com/logo-light.png">',
            '<meta name="twitter:card" content="summary">',
            '<meta name="twitter:title" content="online-trash">',
            '<meta name="twitter:description" content="An endless feed of memes.">',
            '<meta name="twitter:image" content="https://online-trash.com/logo-light.png">',
        ] as $tag) {
            $this->assertStringContainsString($tag, $html);
        }
    }

    public function test_the_robots_tag_is_emitted_only_for_a_non_indexable_page(): void {
        $this->assertStringNotContainsString(
            'name="robots"',
            ShellRenderer::render($this->template(), $this->meta(isIndexable: true)),
        );
        $this->assertStringContainsString(
            '<meta name="robots" content="noindex, follow">',
            ShellRenderer::render($this->template(), $this->meta(isIndexable: false)),
        );
    }

    public function test_attribute_values_are_escaped_with_quotes_and_substitution(): void {
        $html = ShellRenderer::render($this->template(), $this->metaTitled('He said "hi" & \'bye\''));

        $this->assertStringContainsString(
            '<title>He said &quot;hi&quot; &amp; &#039;bye&#039;</title>',
            $html,
        );
        $this->assertStringContainsString(
            '<meta property="og:title" content="He said &quot;hi&quot; &amp; &#039;bye&#039;">',
            $html,
        );
    }

    /**
     * ENT_SUBSTITUTE: invalid UTF-8 degrades to U+FFFD rather than emptying the
     * whole attribute, so a mangled legacy title still describes the page.
     */
    public function test_invalid_utf8_is_substituted_rather_than_emptied(): void {
        $html = ShellRenderer::render($this->template(), $this->metaTitled("bad\xB1byte"));

        $this->assertStringContainsString('<title>bad', $html);
        $this->assertStringContainsString("\u{FFFD}byte</title>", $html);
    }

    /**
     * contracts/shell-response.md → Escaping. Each vector must leave the document's
     * element structure exactly as the template had it plus the injected tags —
     * no attribute breakout, no injected element of any kind.
     */
    public function test_the_escaping_vectors_inject_no_element(): void {
        $template = $this->template();
        // The element structure a harmless title produces. A hostile one must
        // produce exactly the same — that IS the invariant, so it is measured
        // rather than written down as a number that could drift with the tag set.
        $benign = ShellRenderer::render($template, $this->metaTitled('Cat on a roomba'));
        $scripts = substr_count($benign, '<script');
        $metas = substr_count($benign, '<meta');
        $links = substr_count($benign, '<link');

        foreach ([
            'He said "hi"',
            '<script>alert(1)</script>',
            'Tom & Jerry',
            '" /><script>x</script><meta a="',
            '\'; alert(1); //',
        ] as $vector) {
            $html = ShellRenderer::render($template, $this->metaTitled($vector));

            $this->assertSame($scripts, substr_count($html, '<script'), $vector);
            $this->assertSame($metas, substr_count($html, '<meta'), $vector);
            $this->assertSame($links, substr_count($html, '<link'), $vector);
            // Every vector holds at least one of " ' & < >, so none of them may
            // reach the document verbatim. (`alert(1)` on its own is inert text
            // inside an escaped attribute — it is the delimiters that matter.)
            $this->assertStringNotContainsString($vector, $html, $vector);
        }
    }

    /**
     * A template with no </head> is a packaging accident, not a request the user
     * made — degrade by appending rather than dropping the tags or mangling the
     * document.
     */
    public function test_a_template_without_a_head_close_is_not_corrupted(): void {
        $template = '<!doctype html><body><div id="root"></div></body>';

        $html = ShellRenderer::render($template, $this->meta());

        $this->assertStringStartsWith($template, $html);
        $this->assertStringContainsString('<title>online-trash</title>', $html);
    }

    /** FR-028: a PageMeta with no graph emits no block, not an empty one. */
    public function test_metadata_without_a_graph_emits_no_json_ld_block(): void {
        $html = ShellRenderer::render($this->template(), $this->meta());

        $this->assertStringNotContainsString('application/ld+json', $html);
    }

    public function test_a_graph_is_emitted_as_a_single_parseable_json_ld_block(): void {
        $html = ShellRenderer::render($this->template(), $this->metaWithGraph());

        $this->assertSame(1, substr_count($html, 'application/ld+json'));
        $this->assertSame(1, preg_match('#<script type="application/ld\+json">(.*?)</script>#s', $html, $matches));
        $this->assertSame('https://schema.org', json_decode($matches[1], true)['@context']);
    }

    /**
     * The block belongs inside the head like every other tag. Emitting it after
     * </head> would put it in the body, where the SPA's own render owns the DOM.
     */
    public function test_the_json_ld_block_lands_inside_the_head(): void {
        $html = ShellRenderer::render($this->template(), $this->metaWithGraph());

        $this->assertLessThan(strpos($html, '</head>'), strpos($html, 'application/ld+json'));
    }

    /**
     * The payload must NOT be run through htmlspecialchars: inside a <script>
     * element the browser decodes no entities, so an escaped `&quot;` would leave
     * the JSON unparseable. StructuredData's encode flags are the whole defence.
     */
    public function test_the_json_ld_payload_is_not_html_escaped(): void {
        $html = ShellRenderer::render($this->template(), $this->metaWithGraph('He said "hi"'));

        $this->assertSame(1, preg_match('#<script type="application/ld\+json">(.*?)</script>#s', $html, $matches));
        $this->assertStringNotContainsString('&quot;', $matches[1]);
        $this->assertSame('He said "hi"', json_decode($matches[1], true)['@graph'][0]['name']);
    }

    /**
     * A PageMeta carrying a graph. forPost() is the only constructor that produces
     * one, and an unsaved model is enough — nothing on this path queries.
     */
    private function metaWithGraph(string $title = 'Cat on a roomba'): PageMeta {
        $post = new Trashpost();
        $post->forceFill([
            'hash' => 'aB3dEf7GhJ',
            'title' => $title,
            'type' => 'image',
            'file' => null,
            'created_at' => '2026-07-01 12:34:56',
        ]);

        return PageMeta::forPost($post);
    }
}
