<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\PageMeta;
use App\Support\ShellRenderer;
use App\Support\SpaRoutes;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use RuntimeException;

/**
 * Serves the SPA shell for every address that is not a real file or an API route.
 *
 * This is the whole of the feature's server-rendered surface: the <head> and the
 * status code. The body below </head> is the built shell verbatim, so the SPA
 * still routes, fetches and renders exactly as it does today (FR-009).
 */
class ShellController extends Controller {
    /**
     * The shell template, memoised per PHP process and keyed by path.
     *
     * A php-fpm worker serves thousands of requests; re-reading the same file for
     * each one is pure syscall waste on the one code path every visitor hits. Keyed
     * by path so a config override (tests, dev) can never be served a template read
     * from a different location.
     *
     * @var array<string, string>
     */
    private static array $templates = [];

    public function show(Request $request): Response {
        $path = self::normalisePath($request->path());
        // An address the SPA has no view for is a real 404 that still carries the
        // shell, so the SPA renders its own NotFoundPage (FR-014). The further
        // split between a hidden meme (200) and a purged one (404) arrives with US4.
        $status = SpaRoutes::match($path) === null ? 404 : 200;
        $meta = PageMeta::site(self::canonical($path), SpaRoutes::isIndexable($path));

        return response(ShellRenderer::render($this->template(), $meta), $status)
            ->header('Content-Type', 'text/html; charset=UTF-8')
            // The shell is cheap to rebuild, and a moderation action has to take
            // effect on the next request — no intermediary may outlive it (FR-040).
            // Set explicitly rather than left to the session middleware, which
            // happens to emit the same value today: the contract must not depend on
            // a middleware whose caching side effect is incidental to its purpose.
            ->header('Cache-Control', 'no-cache');
    }

    /**
     * Request::path() yields `login` and, for the root, `/`. Everything downstream
     * reasons about leading-slash paths, so normalise once here.
     */
    private static function normalisePath(string $path): string {
        return '/' . ltrim($path, '/');
    }

    /** Absolute, on the canonical origin. Query and fragment are already absent. */
    private static function canonical(string $path): string {
        return rtrim((string) config('app.url'), '/') . $path;
    }

    /**
     * A missing shell is deliberately NOT covered by the FR-038 metadata fallback:
     * there is no useful page to serve without it, so it fails loudly (research
     * D11). deploy/php/entrypoint.sh turns this into a boot-time failure, which is
     * where a packaging error belongs.
     */
    private function template(): string {
        $path = (string) config('seo.shell_path');
        if (!array_key_exists($path, self::$templates)) {
            $contents = is_readable($path) ? file_get_contents($path) : false;
            if ($contents === false) {
                throw new RuntimeException("The SPA shell template is not readable at [{$path}].");
            }
            self::$templates[$path] = $contents;
        }

        return self::$templates[$path];
    }
}
