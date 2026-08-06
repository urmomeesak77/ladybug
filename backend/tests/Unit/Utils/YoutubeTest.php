<?php

declare(strict_types=1);

namespace Tests\Unit\Utils;

use App\Utils\Youtube;
use PHPUnit\Framework\TestCase;

class YoutubeTest extends TestCase {
    public function test_extracts_id_from_watch_url(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    }

    public function test_extracts_id_from_short_url(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://youtu.be/dQw4w9WgXcQ'));
    }

    public function test_extracts_id_from_embed_url(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://www.youtube.com/embed/dQw4w9WgXcQ'));
    }

    public function test_extracts_id_from_shorts_url(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://www.youtube.com/shorts/dQw4w9WgXcQ'));
    }

    public function test_extracts_id_from_shorts_url_on_any_host_form(): void {
        // Host-agnostic by design: the same clip is shared as youtube.com, m.youtube.com
        // and the bare host, and all three must yield the same id (spec Assumptions).
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://m.youtube.com/shorts/dQw4w9WgXcQ'));
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('https://youtube.com/shorts/dQw4w9WgXcQ'));
    }

    public function test_extracts_id_from_shorts_url_with_query_params(): void {
        $this->assertSame(
            'dQw4w9WgXcQ',
            Youtube::extractId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'),
        );
    }

    public function test_is_short_is_true_for_a_shorts_url(): void {
        $this->assertTrue(Youtube::isShort('https://www.youtube.com/shorts/dQw4w9WgXcQ'));
        $this->assertTrue(Youtube::isShort('  https://m.youtube.com/shorts/dQw4w9WgXcQ  '));
    }

    public function test_is_short_is_false_for_every_other_recognized_form(): void {
        $this->assertFalse(Youtube::isShort('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
        $this->assertFalse(Youtube::isShort('https://youtu.be/dQw4w9WgXcQ'));
        $this->assertFalse(Youtube::isShort('https://www.youtube.com/embed/dQw4w9WgXcQ'));
        $this->assertFalse(Youtube::isShort('dQw4w9WgXcQ'));
    }

    public function test_is_short_is_false_for_non_youtube_input(): void {
        // The word alone is not the /shorts/{id} path — no false positive (spec Edge Cases).
        $this->assertFalse(Youtube::isShort('https://example.com/i-love-shorts'));
        $this->assertFalse(Youtube::isShort('not a url'));
        $this->assertFalse(Youtube::isShort(''));
    }

    public function test_accepts_a_bare_id(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('dQw4w9WgXcQ'));
    }

    public function test_trims_whitespace(): void {
        $this->assertSame('dQw4w9WgXcQ', Youtube::extractId('  dQw4w9WgXcQ  '));
    }

    public function test_returns_null_for_non_youtube_input(): void {
        $this->assertNull(Youtube::extractId('https://example.com/video'));
        $this->assertNull(Youtube::extractId('not a url'));
        $this->assertNull(Youtube::extractId(''));
    }
}
