<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\FfmpegVideo;
use PHPUnit\Framework\TestCase;

/**
 * FfmpegVideo wraps ffprobe/ffmpeg (research.md #2) for real content inspection and
 * poster-frame extraction. Dimensions are asserted only as positive (fixture pixel
 * sizes are not pinned), mirroring the real-media test convention elsewhere.
 */
final class FfmpegVideoTest extends TestCase {
    private string $dir;

    private string $fixtures;

    protected function setUp(): void {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/ffmpegvideo_' . uniqid();
        mkdir($this->dir);
        $this->fixtures = dirname(__DIR__, 2) . '/fixtures';
    }

    protected function tearDown(): void {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
        parent::tearDown();
    }

    public function test_probe_returns_stream_info_for_an_mp4(): void {
        $probe = (new FfmpegVideo())->probe("{$this->fixtures}/sample.mp4");

        $this->assertNotNull($probe);
        $this->assertGreaterThan(0, $probe['width']);
        $this->assertGreaterThan(0, $probe['height']);
        $this->assertNotSame('', $probe['codec']);
    }

    public function test_probe_returns_stream_info_for_a_webm(): void {
        $probe = (new FfmpegVideo())->probe("{$this->fixtures}/sample.webm");

        $this->assertNotNull($probe);
        $this->assertGreaterThan(0, $probe['width']);
        $this->assertGreaterThan(0, $probe['height']);
        $this->assertNotSame('', $probe['codec']);
    }

    public function test_probe_returns_null_for_a_non_video_file(): void {
        $path = "{$this->dir}/garbage.mp4";
        file_put_contents($path, 'not a real video, just bytes');

        $this->assertNull((new FfmpegVideo())->probe($path));
    }

    public function test_extract_poster_frame_writes_a_readable_jpeg_from_an_mp4(): void {
        $dest = "{$this->dir}/poster.jpg";

        $result = (new FfmpegVideo())->extractPosterFrame("{$this->fixtures}/sample.mp4", $dest);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        $this->assertNotFalse(getimagesize($dest));
    }

    public function test_extract_poster_frame_writes_a_readable_jpeg_from_a_webm(): void {
        $dest = "{$this->dir}/poster.jpg";

        $result = (new FfmpegVideo())->extractPosterFrame("{$this->fixtures}/sample.webm", $dest);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        $this->assertNotFalse(getimagesize($dest));
    }

    /**
     * sample-nonfaststart.mp4 is sample.mp4 re-muxed with ffmpeg's default (no
     * +faststart) settings, which write the moov atom after mdat — reproducing what
     * phone/camera encoders commonly produce. Chrome refuses to seek such a file (its
     * `video.seekable` stays [0,0] even once fully buffered) while Firefox tolerates it,
     * which is why scrubbing looked browser-specific.
     */
    public function test_remux_faststart_moves_moov_before_mdat(): void {
        $dest = "{$this->dir}/remuxed.mp4";

        $result = (new FfmpegVideo())->remuxFaststart("{$this->fixtures}/sample-nonfaststart.mp4", $dest);

        $this->assertTrue($result);
        $this->assertFileExists($dest);
        $bytes = (string) file_get_contents($dest);
        $this->assertLessThan(strpos($bytes, 'mdat'), strpos($bytes, 'moov'));
    }

    public function test_remux_faststart_preserves_stream_dimensions(): void {
        $dest = "{$this->dir}/remuxed.mp4";
        $ffmpeg = new FfmpegVideo();
        $before = $ffmpeg->probe("{$this->fixtures}/sample-nonfaststart.mp4");

        $ffmpeg->remuxFaststart("{$this->fixtures}/sample-nonfaststart.mp4", $dest);
        $after = $ffmpeg->probe($dest);

        $this->assertSame($before['width'], $after['width']);
        $this->assertSame($before['height'], $after['height']);
    }

    public function test_remux_faststart_returns_false_for_a_non_video_file(): void {
        $src = "{$this->dir}/garbage.mp4";
        file_put_contents($src, 'not a real video, just bytes');
        $dest = "{$this->dir}/remuxed.mp4";

        $this->assertFalse((new FfmpegVideo())->remuxFaststart($src, $dest));
    }
}
