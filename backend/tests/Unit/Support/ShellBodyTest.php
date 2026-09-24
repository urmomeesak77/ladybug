<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Models\Trashpost;
use App\Support\MediaPath;
use App\Support\ShellBody;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class ShellBodyTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        config([
            'app.url' => 'https://online-trash.com',
            'seo.untitled_label' => 'Untitled meme',
        ]);
    }

    /**
     * A visible image post whose 300px variant exists on the faked disk, so
     * TrashpostImageService::imageData() resolves a real URL for it.
     */
    private function makePost(string $hash, ?string $title): Trashpost {
        $post = Trashpost::factory()->visible()->make(['file' => "{$hash}.gif", 'title' => $title]);
        $post->hash = $hash;
        // An unsaved model has no timestamps, and byline() needs one — without this
        // every assertion about the byline would pass vacuously against no byline.
        $post->created_at = '2015-10-13 15:37:04';
        Storage::disk('public')->put(MediaPath::imageRelativePath('300', $hash, 'gif'), 'x');

        return $post;
    }

    public function test_a_post_body_carries_the_title_as_the_only_h1(): void {
        $html = ShellBody::forPost($this->makePost('yccc6UCq89', 'Kitty jump'));

        $this->assertSame(1, substr_count($html, '<h1'));
        $this->assertStringContainsString('<h1>Kitty jump</h1>', $html);
    }

    public function test_a_post_body_carries_the_media_image_captioned_by_the_title(): void {
        $html = ShellBody::forPost($this->makePost('yccc6UCq89', 'Kitty jump'));

        $this->assertStringContainsString('yccc6UCq89.gif', $html);
        $this->assertStringContainsString('alt="Kitty jump"', $html);
    }

    public function test_an_untitled_post_falls_back_to_the_configured_label(): void {
        $html = ShellBody::forPost($this->makePost('yccc6UCq89', null));

        $this->assertStringContainsString('<h1>Untitled meme</h1>', $html);
    }

    public function test_a_post_body_escapes_a_hostile_title(): void {
        $html = ShellBody::forPost($this->makePost('yccc6UCq89', '"><script>alert(1)</script>'));

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }

    public function test_a_feed_body_links_every_post_to_its_permalink(): void {
        $posts = new Collection([$this->makePost('aaaaaaaaaa', 'First'), $this->makePost('bbbbbbbbbb', 'Second')]);

        $html = ShellBody::forFeed($posts, null);

        $this->assertStringContainsString('href="/posts/aaaaaaaaaa"', $html);
        $this->assertStringContainsString('href="/posts/bbbbbbbbbb"', $html);
    }

    public function test_a_feed_entry_uses_the_title_as_its_anchor_text(): void {
        $posts = new Collection([$this->makePost('aaaaaaaaaa', 'Kitty jump')]);

        $html = ShellBody::forFeed($posts, null);

        $this->assertStringContainsString('<a href="/posts/aaaaaaaaaa">Kitty jump</a>', $html);
    }


    public function test_a_post_body_escapes_a_hostile_author_name(): void {
        $post = $this->makePost('yccc6UCq89', 'Kitty jump');
        $post->username = '"><script>alert(1)</script>';

        $html = ShellBody::forPost($post);

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }

    public function test_an_authorless_post_still_carries_its_date(): void {
        $post = $this->makePost('yccc6UCq89', 'Kitty jump');
        $post->username = null;

        $html = ShellBody::forPost($post);

        $this->assertStringContainsString('<time datetime=', $html);
        $this->assertStringNotContainsString('Posted by', $html);
    }

    public function test_a_feed_body_carries_a_next_link_holding_the_cursor(): void {
        $posts = new Collection([$this->makePost('aaaaaaaaaa', 'First')]);

        $html = ShellBody::forFeed($posts, 'aaaaaaaaaa');

        $this->assertStringContainsString('href="/?after=aaaaaaaaaa"', $html);
    }

    public function test_a_feed_body_omits_the_next_link_on_the_last_page(): void {
        $posts = new Collection([$this->makePost('aaaaaaaaaa', 'First')]);

        $html = ShellBody::forFeed($posts, null);

        $this->assertStringNotContainsString('?after=', $html);
    }

    public function test_an_empty_feed_renders_no_markup_at_all(): void {
        $this->assertSame('', ShellBody::forFeed(new Collection(), null));
    }
}
