<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\MediaPath;
use PHPUnit\Framework\TestCase;

final class MediaPathTest extends TestCase {
    public function test_image_sizes_are_returned_in_canonical_order(): void {
        $this->assertSame(['original', '800', '500', '300', '100'], MediaPath::imageSizes());
    }

    public function test_shard_for_uses_lowercased_first_character(): void {
        $this->assertSame('1', MediaPath::shardFor('1dcmpenbnr.jpg'));
        $this->assertSame('a', MediaPath::shardFor('Abc.png'));
        $this->assertSame('z', MediaPath::shardFor('zEBRA.gif'));
    }

    public function test_shard_for_falls_back_to_other_for_non_alphanumeric_lead(): void {
        $this->assertSame('other', MediaPath::shardFor('_hidden.gif'));
        $this->assertSame('other', MediaPath::shardFor('-dash.jpeg'));
    }

    public function test_is_media_file_accepts_allowlisted_extensions_case_insensitively(): void {
        $this->assertTrue(MediaPath::isMediaFile('photo.jpg'));
        $this->assertTrue(MediaPath::isMediaFile('photo.JPEG'));
        $this->assertTrue(MediaPath::isMediaFile('photo.Png'));
        $this->assertTrue(MediaPath::isMediaFile('photo.GIF'));
    }

    public function test_is_media_file_rejects_non_media_files(): void {
        $this->assertFalse(MediaPath::isMediaFile('.gitignore'));
        $this->assertFalse(MediaPath::isMediaFile('notes.txt'));
        $this->assertFalse(MediaPath::isMediaFile('clip.mp4'));
        $this->assertFalse(MediaPath::isMediaFile('noextension'));
    }

    public function test_image_relative_path_assembles_size_shard_and_filename(): void {
        $this->assertSame(
            'image/trash/300/1/1dcmpenbnr.jpg',
            MediaPath::imageRelativePath('300', '1dcmpenbnr', 'jpg'),
        );
        $this->assertSame(
            'image/trash/original/a/Abc.png',
            MediaPath::imageRelativePath('original', 'Abc', 'png'),
        );
        $this->assertSame(
            'image/trash/100/other/-dash.jpeg',
            MediaPath::imageRelativePath('100', '-dash', 'jpeg'),
        );
    }

    public function test_video_relative_path_has_no_size_segment(): void {
        $this->assertSame(
            'video/trash/9/9zq-abc_de.mp4',
            MediaPath::videoRelativePath('9zq-abc_de', 'mp4'),
        );
        $this->assertSame(
            'video/trash/a/Abc.webm',
            MediaPath::videoRelativePath('Abc', 'webm'),
        );
    }

    public function test_video_relative_path_uses_the_other_shard_for_non_alphanumeric_lead(): void {
        $this->assertSame(
            'video/trash/other/_clip.mp4',
            MediaPath::videoRelativePath('_clip', 'mp4'),
        );
    }

    public function test_youtube_thumbnail_relative_path_shards_by_lowercased_video_id_lead(): void {
        $this->assertSame(
            'image/trash/youtube/a/AbCdEfGhIjK.jpg',
            MediaPath::youtubeThumbnailRelativePath('AbCdEfGhIjK'),
        );
        $this->assertSame(
            'image/trash/youtube/d/dQw4w9WgXcQ.jpg',
            MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ'),
        );
    }

    public function test_youtube_thumbnail_relative_path_uses_the_other_shard_for_non_alphanumeric_lead(): void {
        $this->assertSame(
            'image/trash/youtube/other/-bCdEfGhIjK.jpg',
            MediaPath::youtubeThumbnailRelativePath('-bCdEfGhIjK'),
        );
    }
}
