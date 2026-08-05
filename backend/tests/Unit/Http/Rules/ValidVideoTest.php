<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Rules;

use App\Http\Rules\ValidVideo;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\TestCase;

/**
 * Deep content check beyond MIME sniffing (research.md #2, #5): a decodable video passes,
 * a corrupt/unreadable one fails with a message that doesn't overlap Laravel's default
 * mimetypes/max wording (contracts/api-posts.md 422 table).
 */
final class ValidVideoTest extends TestCase {
    private string $fixtures;

    protected function setUp(): void {
        parent::setUp();
        $this->fixtures = dirname(__DIR__, 3) . '/fixtures';
    }

    /** A real fixture presented as an upload, without the isValid() test-mode restriction. */
    private function fixtureUpload(string $fixture, string $mime): UploadedFile {
        return new UploadedFile("{$this->fixtures}/{$fixture}", $fixture, $mime, null, true);
    }

    public function test_passes_for_a_real_mp4(): void {
        $rule = new ValidVideo();
        $failed = false;

        $rule->validate('video', $this->fixtureUpload('sample.mp4', 'video/mp4'), function () use (&$failed) {
            $failed = true;
        });

        $this->assertFalse($failed);
    }

    public function test_passes_for_a_real_webm(): void {
        $rule = new ValidVideo();
        $failed = false;

        $rule->validate('video', $this->fixtureUpload('sample.webm', 'video/webm'), function () use (&$failed) {
            $failed = true;
        });

        $this->assertFalse($failed);
    }

    public function test_fails_with_a_distinct_message_for_a_non_video_file(): void {
        $fake = UploadedFile::fake()->create('bad.mp4', 10, 'video/mp4');
        $rule = new ValidVideo();
        $message = null;

        $rule->validate('video', $fake, function (string $msg) use (&$message) {
            $message = $msg;
        });

        $this->assertNotNull($message);
        // Must not read like Laravel's default mimetypes/max messages.
        $this->assertStringNotContainsStringIgnoringCase('mime types', $message);
        $this->assertStringNotContainsStringIgnoringCase('greater than', $message);
        $this->assertStringContainsStringIgnoringCase('corrupt', $message);
    }

    public function test_ignores_a_non_uploaded_file_value(): void {
        // Defensive branch: the rule only inspects an UploadedFile instance.
        $rule = new ValidVideo();
        $failed = false;

        $rule->validate('video', 'not-a-file', function () use (&$failed) {
            $failed = true;
        });

        $this->assertFalse($failed);
    }
}
