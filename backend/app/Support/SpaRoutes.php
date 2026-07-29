<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The SPA's address table, as the server sees it.
 *
 * MIRROR: frontend/src/App.tsx holds the same table as <Route> elements. The two
 * are maintained by hand and must be changed together — adding a client route
 * without adding it here makes that address answer 404 with the not-found view,
 * which is a silent bug for anyone who bookmarks or shares it. The duplication is
 * accepted deliberately (plan.md → Complexity Tracking): only the server can pick
 * a status code, so only the server can be the one to know which addresses exist.
 *
 * Every method is static and pure — no request, no database, no config.
 */
class SpaRoutes {
    public const HOME = '/';

    public const POST = '/posts/{hash}';

    public const LOGIN = '/login';

    public const REGISTER = '/register';

    public const ACCOUNT = '/account';

    public const UPLOAD = '/upload';

    public const VERIFY_EMAIL = '/verify-email';

    public const VERIFY_EMAIL_HASH = '/verify-email/{hash}';

    public const ADMIN_TRASHPOSTS = '/admin/trashposts';

    public const ADMIN_USERS = '/admin/users';

    /** The public identifier's shape (Constitution V): 10 chars of [A-Za-z0-9-_]. */
    private const HASH_PATTERN = '[A-Za-z0-9_-]{10}';

    /** Fixed addresses, each mapped to whether a search engine may index it. */
    private const STATIC_ROUTES = [
        self::HOME => true,
        self::LOGIN => false,
        self::REGISTER => false,
        self::ACCOUNT => false,
        self::UPLOAD => false,
        self::VERIFY_EMAIL => false,
        self::ADMIN_TRASHPOSTS => false,
        self::ADMIN_USERS => false,
    ];

    /** Parameterised addresses, each with its anchored regex and indexability. */
    private const DYNAMIC_ROUTES = [
        self::POST => [
            'pattern' => '#^/posts/' . self::HASH_PATTERN . '$#',
            'indexable' => true,
        ],
        self::VERIFY_EMAIL_HASH => [
            'pattern' => '#^/verify-email/' . self::HASH_PATTERN . '$#',
            'indexable' => false,
        ],
    ];

    /**
     * The address this path resolves to, as one of the constants above, or null
     * when the SPA has no view for it — which is what makes it a 404.
     *
     * A malformed identifier fails the pattern here, so it never becomes a query.
     */
    public static function match(string $path): ?string {
        if (array_key_exists($path, self::STATIC_ROUTES)) {
            return $path;
        }

        foreach (self::DYNAMIC_ROUTES as $route => $spec) {
            if (preg_match($spec['pattern'], $path) === 1) {
                return $route;
            }
        }

        return null;
    }

    /**
     * Whether this address may be indexed.
     *
     * For a permalink this answers for the address CLASS only — a meme that is
     * pending or soft-deleted is demoted to noindex by PageMetaService, which is
     * the only layer that can see the row. An unmatched address is never indexable.
     */
    public static function isIndexable(string $path): bool {
        $route = self::match($path);
        if ($route === null) {
            return false;
        }

        if (array_key_exists($route, self::STATIC_ROUTES)) {
            return self::STATIC_ROUTES[$route];
        }

        return self::DYNAMIC_ROUTES[$route]['indexable'];
    }

    /**
     * The fixed addresses that belong in the sitemap. In practice `/` alone:
     * everything else in the table is behind a login or a signed link.
     *
     * @return list<string>
     */
    public static function indexableStaticPaths(): array {
        $paths = [];
        foreach (self::STATIC_ROUTES as $path => $indexable) {
            if ($indexable) {
                $paths[] = $path;
            }
        }

        return $paths;
    }

    /**
     * The prefixes robots.txt disallows. Generated from the same table that drives
     * the noindex tags, so FR-012 and FR-021 cannot disagree. `/verify-email` and
     * `/admin/` are prefixes and therefore cover their dynamic children too.
     *
     * @return list<string>
     */
    public static function disallowedPaths(): array {
        return [
            self::LOGIN,
            self::REGISTER,
            self::ACCOUNT,
            self::UPLOAD,
            self::VERIFY_EMAIL,
            '/admin/',
        ];
    }
}
