<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\PageMeta;
use InvalidArgumentException;
use Tests\TestCase;

final class PageMetaTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        config([
            'app.url' => 'https://online-trash.com',
            'seo.site_name' => 'online-trash',
            'seo.site_description' => 'An endless feed of memes.',
            'seo.fallback_image' => '/logo-light.png',
        ]);
    }

    public function test_site_metadata_carries_the_configured_site_copy(): void {
        $meta = PageMeta::site('https://online-trash.com/', isIndexable: true);

        $this->assertSame('online-trash', $meta->title);
        $this->assertSame('An endless feed of memes.', $meta->description);
        $this->assertSame('online-trash', $meta->socialTitle);
        $this->assertSame('An endless feed of memes.', $meta->socialDescription);
        $this->assertSame('https://online-trash.com/', $meta->canonical);
        $this->assertTrue($meta->isIndexable);
    }

    /**
     * Every generic address is a `website`; only a meme permalink is an `article`
     * (contract → Head block). Carried on the value object rather than derived at
     * render time so the renderer never has to guess which construction path it
     * was handed.
     */
    public function test_site_metadata_is_an_og_website(): void {
        $this->assertSame('website', PageMeta::site('https://online-trash.com/', isIndexable: true)->ogType);
    }

    public function test_site_metadata_falls_back_to_the_branded_image_on_a_summary_card(): void {
        $meta = PageMeta::site('https://online-trash.com/login', isIndexable: false);

        // FR-006: absolute, always present — an unfurl card is never left imageless.
        $this->assertSame('https://online-trash.com/logo-light.png', $meta->imageUrl);
        // D7: a square logo stretched into a large-image card looks broken.
        $this->assertFalse($meta->isLargeImageCard);
    }

    /**
     * A fallback image configured as a full URL (a CDN, say) is used as given —
     * absolutising it against APP_URL a second time would produce a broken address.
     */
    public function test_an_already_absolute_fallback_image_is_left_alone(): void {
        config(['seo.fallback_image' => 'https://cdn.example.com/logo-light.png']);

        $meta = PageMeta::site('https://online-trash.com/', isIndexable: true);

        $this->assertSame('https://cdn.example.com/logo-light.png', $meta->imageUrl);
    }

    public function test_a_non_indexable_page_carries_no_structured_data(): void {
        $meta = PageMeta::site('https://online-trash.com/account', isIndexable: false);

        $this->assertFalse($meta->isIndexable);
        $this->assertNull($meta->structuredData);
    }

    /**
     * FR-010/FR-028: a hidden meme's page is site metadata and nothing else, so no
     * meme-derived value can leak through the address it shares with the real page.
     */
    public function test_a_hidden_memes_page_is_site_metadata_under_its_own_address(): void {
        $meta = PageMeta::site('https://online-trash.com/posts/aB3dEf7-h_', isIndexable: false);

        $this->assertSame('online-trash', $meta->title);
        $this->assertSame('An endless feed of memes.', $meta->description);
        $this->assertSame('https://online-trash.com/logo-light.png', $meta->imageUrl);
        $this->assertSame('https://online-trash.com/posts/aB3dEf7-h_', $meta->canonical);
    }

    /**
     * The data model's structural invariant: structuredData !== null implies
     * isIndexable === true. Enforced in the constructor so no future construction
     * path — including a hand-edited cache entry — can emit rich results for a page
     * that is telling search engines not to index it.
     */
    public function test_structured_data_on_a_non_indexable_page_is_rejected(): void {
        $payload = PageMeta::site('https://online-trash.com/', isIndexable: false)->toArray();
        $payload['structuredData'] = ['@context' => 'https://schema.org'];

        $this->expectException(InvalidArgumentException::class);
        PageMeta::fromArray($payload);
    }

    public function test_a_cache_round_trip_reproduces_an_identical_object(): void {
        $meta = PageMeta::site('https://online-trash.com/', isIndexable: true);

        $this->assertEquals($meta, PageMeta::fromArray($meta->toArray()));
    }

    public function test_the_cache_payload_is_a_plain_array(): void {
        $payload = PageMeta::site('https://online-trash.com/', isIndexable: true)->toArray();

        $this->assertSame([
            'title', 'description', 'canonical', 'ogType', 'socialTitle', 'socialDescription',
            'imageUrl', 'isLargeImageCard', 'isIndexable', 'structuredData',
        ], array_keys($payload));
    }
}
