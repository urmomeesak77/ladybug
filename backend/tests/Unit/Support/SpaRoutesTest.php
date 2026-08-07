<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\SpaRoutes;
use PHPUnit\Framework\TestCase;

final class SpaRoutesTest extends TestCase {
    /** A conforming public identifier: 10 characters of [A-Za-z0-9-_] (Constitution V). */
    private const HASH = 'aB3dEf7-h_';

    public function test_home_is_a_known_address(): void {
        $this->assertSame(SpaRoutes::HOME, SpaRoutes::match('/'));
    }

    public function test_a_permalink_is_a_known_address(): void {
        $this->assertSame(SpaRoutes::POST, SpaRoutes::match('/posts/' . self::HASH));
    }

    public function test_the_static_noindex_addresses_are_known(): void {
        $this->assertSame(SpaRoutes::LOGIN, SpaRoutes::match('/login'));
        $this->assertSame(SpaRoutes::REGISTER, SpaRoutes::match('/register'));
        $this->assertSame(SpaRoutes::ACCOUNT, SpaRoutes::match('/account'));
        $this->assertSame(SpaRoutes::UPLOAD, SpaRoutes::match('/upload'));
        $this->assertSame(SpaRoutes::VERIFY_EMAIL, SpaRoutes::match('/verify-email'));
        $this->assertSame(SpaRoutes::ADMIN_TRASHPOSTS, SpaRoutes::match('/admin/trashposts'));
        $this->assertSame(SpaRoutes::ADMIN_USERS, SpaRoutes::match('/admin/users'));
    }

    public function test_the_recovery_request_address_is_a_known_address(): void {
        $this->assertSame(SpaRoutes::FORGOT_PASSWORD, SpaRoutes::match('/forgot-password'));
    }

    public function test_a_malformed_recovery_request_address_matches_nothing(): void {
        // A fixed address matches exactly or not at all — no prefix, no trailing segment.
        $this->assertNull(SpaRoutes::match('/forgot-password/'));
        $this->assertNull(SpaRoutes::match('/forgot-password/extra'));
        $this->assertNull(SpaRoutes::match('/forgot-passwords'));
    }

    public function test_the_signed_verification_address_is_a_known_dynamic_address(): void {
        $this->assertSame(SpaRoutes::VERIFY_EMAIL_HASH, SpaRoutes::match('/verify-email/' . self::HASH));
    }

    public function test_an_unknown_address_matches_nothing(): void {
        $this->assertNull(SpaRoutes::match('/nope'));
        $this->assertNull(SpaRoutes::match('/posts'));
        $this->assertNull(SpaRoutes::match('/posts/' . self::HASH . '/y'));
    }

    /**
     * The hash format is enforced by the pattern itself, so a malformed identifier
     * is a 404 decided in pure PHP and never reaches the database.
     */
    public function test_a_permalink_whose_hash_is_the_wrong_length_matches_nothing(): void {
        $this->assertNull(SpaRoutes::match('/posts/abc'));
        $this->assertNull(SpaRoutes::match('/posts/aB3dEf7GhJx'));
    }

    public function test_a_permalink_whose_hash_holds_a_disallowed_character_matches_nothing(): void {
        $this->assertNull(SpaRoutes::match('/posts/aB3dEf7.h_'));
    }

    public function test_home_and_permalinks_are_indexable(): void {
        $this->assertTrue(SpaRoutes::isIndexable('/'));
        $this->assertTrue(SpaRoutes::isIndexable('/posts/' . self::HASH));
    }

    public function test_the_account_and_admin_addresses_are_not_indexable(): void {
        foreach (['/login', '/register', '/account', '/upload', '/verify-email',
            '/verify-email/' . self::HASH, '/forgot-password', '/admin/trashposts', '/admin/users'] as $path) {
            $this->assertFalse(SpaRoutes::isIndexable($path), $path . ' must not be indexable');
        }
    }

    public function test_an_unknown_address_is_not_indexable(): void {
        $this->assertFalse(SpaRoutes::isIndexable('/nope'));
    }

    public function test_the_home_feed_is_the_only_indexable_static_address(): void {
        $this->assertSame(['/'], SpaRoutes::indexableStaticPaths());
    }

    /**
     * robots.txt is generated from this list, so FR-012's noindex set and FR-021's
     * Disallow set cannot drift apart. `/verify-email` and `/admin/` are prefixes
     * that cover their dynamic children, which is why there are seven and not nine.
     */
    public function test_the_disallowed_prefixes_are_the_noindex_areas(): void {
        $this->assertSame(
            ['/login', '/register', '/account', '/upload', '/verify-email', '/forgot-password', '/admin/'],
            SpaRoutes::disallowedPaths(),
        );
    }
}
