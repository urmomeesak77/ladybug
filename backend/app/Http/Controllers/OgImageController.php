<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Trashpost;
use App\Services\OgImageService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

/**
 * Serves `/og/{hash}.jpg` — the JPEG a meme's unfurl card is built from.
 *
 * A separate address rather than a link straight into /storage/ because the file does
 * not exist until someone asks for it, and og:image has to be a URL that already
 * works when the crawler arrives. Only crawlers read it, so serving the bytes through
 * PHP costs nothing worth optimising and keeps nginx out of the change entirely.
 *
 * Visibility is the SAME publiclyVisible() scope every other public reader uses, so a
 * pending or soft-deleted meme's preview is not a back door around moderation.
 */
class OgImageController extends Controller {
    /** Matches the /storage/ media policy: the bytes for a given hash never change. */
    private const CACHE_SECONDS = 2592000;

    public function __construct(private readonly OgImageService $previews) {
    }

    public function show(string $hash): BinaryFileResponse {
        $post = Trashpost::publiclyVisible()->where('hash', $hash)->first();
        $path = $post === null ? null : $this->generate($post);
        if ($path === null) {
            abort(404);
        }

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return response()->file($disk->path($path), [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'public, max-age=' . self::CACHE_SECONDS . ', immutable',
        ]);
    }

    /**
     * Null when there is no preview to serve, for either reason: the meme has no image
     * bytes, or the ones it has will not decode.
     *
     * A corrupt source is deliberately a 404 and not a 500. The card degrades to no
     * image, which is exactly what the crawler would have shown anyway — a 500 would
     * add an error page to a crawl budget and tell the crawler to come back.
     *
     * Throwable, not RuntimeException: a decoder failure does not always arrive as one.
     * GD reports through PHP warnings, which the framework's error handler promotes to
     * ErrorException, and a narrower catch let exactly that reach the crawler as a 500.
     */
    private function generate(Trashpost $post): ?string {
        try {
            return $this->previews->ensure($post);
        }
        catch (Throwable $e) {
            Log::warning('Unfurl preview could not be generated', [
                'hash' => $post->hash,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }
}
