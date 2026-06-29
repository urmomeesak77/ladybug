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
