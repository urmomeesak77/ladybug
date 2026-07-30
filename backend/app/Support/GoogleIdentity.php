<?php

declare(strict_types=1);

namespace App\Support;

use App\Exceptions\OAuthFailure;

/**
 * The identity Google asserted, bounded and total by construction (FR-024). Nothing
 * downstream has to re-check a field: an instance that exists is one whose `sub` and
 * `email` are within the column widths and whose `displayName()` is non-empty.
 *
 * The name is kept RAW and escaped on output — React renders it as a text child and
 * this codebase never uses dangerouslySetInnerHTML. That is the identical treatment
 * feature 015 gives comment bodies; escaping at write time would double-escape and
 * corrupt a legitimate name containing '&' or an apostrophe (research D13).
 */
final class GoogleIdentity {
    /** The width of both `users.name` and `users.email`. */
    private const MAX_LENGTH = 255;

    /** Unreachable while FR-005 guarantees an address, but the method is total by
     * construction rather than by argument (research D13). */
    private const FALLBACK_NAME = 'Ladybug user';

    /**
     * The only three forms that mean "Google confirmed this address". Google sends a
     * JSON boolean; the other two are defensive. Note a *string* "false" is truthy in
     * PHP, which is why this is an allow-list rather than a cast.
     */
    private const VERIFIED_CLAIMS = [true, 'true', 1];

    public function __construct(
        public readonly string $sub,
        public readonly string $email,
        public readonly bool $isEmailVerified,
        public readonly ?string $name = null,
    ) {
        if ($sub === '' || mb_strlen($sub) > self::MAX_LENGTH) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        // Length before format, deliberately: PHP's FILTER_VALIDATE_EMAIL already
        // refuses anything over 254 characters, so this bound is what would still
        // hold if that ever changed — and it is the one that protects the column.
        if (mb_strlen($email) > self::MAX_LENGTH) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new OAuthFailure(OAuthFailure::PROVIDER);
        }
    }

    /**
     * Build from an ID token's claims. Callers must establish that an `email` claim is
     * PRESENT before calling — an absent address is FR-005's `unverified_email`
     * refusal, not the `provider` refusal an empty string produces here.
     *
     * @param  array<string, mixed>  $claims
     */
    public static function fromClaims(array $claims): self {
        return new self(
            is_scalar($claims['sub'] ?? null) ? (string) $claims['sub'] : '',
            is_scalar($claims['email'] ?? null) ? (string) $claims['email'] : '',
            in_array($claims['email_verified'] ?? null, self::VERIFIED_CLAIMS, true),
            is_scalar($claims['name'] ?? null) ? (string) $claims['name'] : null,
        );
    }

    /**
     * A name for the account, never empty and never wider than the column (FR-016):
     * the cleaned `name` claim, else the address's local part, else a literal.
     */
    public function displayName(): string {
        $name = self::clean($this->name ?? '');
        if ($name !== '') {
            return $name;
        }

        $local = self::clean(explode('@', $this->email)[0]);

        return $local === '' ? self::FALLBACK_NAME : $local;
    }

    /**
     * Strip Unicode control characters, trim, and cap at the column width. The cap
     * counts characters rather than bytes so a cut never lands mid-codepoint.
     */
    private static function clean(string $value): string {
        $stripped = trim((string) preg_replace('/\p{C}/u', '', $value));

        return mb_substr($stripped, 0, self::MAX_LENGTH);
    }
}
