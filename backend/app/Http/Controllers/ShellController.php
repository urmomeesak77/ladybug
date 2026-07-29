<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\PageMetaService;
use App\Support\PageMeta;
use App\Support\ShellRenderer;
use App\Support\SpaRoutes;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use RuntimeException;
use Throwable;

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

    public function __construct(
        private readonly PageMetaService $meta = new PageMetaService(),
    ) {
    }

    public function show(Request $request): Response {
        $path = self::normalisePath($request->path());
        [$meta, $status] = $this->resolve($path);

        // Rendering sits OUTSIDE resolve() rather than inside its try/catch, so that
        // a renderer bug surfaces as a real error instead of being swallowed into
        // generic metadata (research D11). The separation is structural, not a
        // comment on a wider catch block.
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
     * The metadata and status one address answers with.
     *
     * @return array{0: PageMeta, 1: int}
     */
    private function resolve(string $path): array {
        // What the address table alone can say: an address the SPA has no view for is
        // a real 404 that still carries the shell, so the SPA renders its own
        // NotFoundPage (FR-014). Computed before — and outside — the resolution below
        // because it is also the status the FR-038 fallback answers with.
        $status = SpaRoutes::match($path) === null ? 404 : 200;

        try {
            // Every address goes through the same resolver: a permalink picks up its
            // meme's own metadata, everything else the generic site block. Routing
            // them through one call is what keeps the canonical rule in a single
            // place rather than one per branch. statusFor() then refines the status
            // for a permalink, where only the row lookup can tell a hidden meme (200)
            // from a purged one (404); it reads the record forPath() just resolved,
            // so it costs neither a second query nor a second cache read — and the
            // two answers cannot disagree even if a moderation transition lands
            // between these lines.
            return [$this->meta->forPath($path), $this->meta->statusFor($path)];
        }
        catch (Throwable $e) {
            // FR-038: metadata is an enhancement, never a dependency. A failure
            // degrades to the generic noindex block at the status the route table
            // already decided — never a 5xx handed to a crawler. The reassignment is
            // unconditional, so a throw from statusFor() after forPath() succeeded
            // cannot leave a real meme's metadata in the response.
            report($e);

            return [PageMeta::site(PageMetaService::canonicalFor($path), isIndexable: false), $status];
        }
    }

    /**
     * Request::path() yields `login` and, for the root, `/`. Everything downstream
     * reasons about leading-slash paths, so normalise once here.
     */
    private static function normalisePath(string $path): string {
        return '/' . ltrim($path, '/');
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
