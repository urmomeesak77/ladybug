<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * A refused Google sign-in, carrying exactly one of the seven closed error codes
 * from research D10. Its whole purpose is to keep GoogleAuthController's error path
 * a single `catch` rather than a chain of `if`s: every refusal, wherever it is
 * raised, arrives at one place that turns the code into
 * `302 → {FRONTEND_URL}/login?error={code}`.
 *
 * The code travels on a public readonly property rather than in the inherited
 * `$code`, which is an int.
 */
final class OAuthFailure extends RuntimeException {
    /** The visitor declined at Google's consent screen. */
    public const CANCELLED = 'cancelled';

    /** State missing, altered, mismatched, expired, or already used — one code for
     * five failures, so a refusal does not tell an attacker which half they beat. */
    public const STATE = 'state';

    /** No email claim, or `email_verified` not true — the guard under the auto-link. */
    public const UNVERIFIED_EMAIL = 'unverified_email';

    /** The matched account is already linked to a different Google account. */
    public const ALREADY_LINKED = 'already_linked';

    /** The account's access is revoked; refused at the Google door as at the password one. */
    public const DISABLED = 'disabled';

    /** Past the per-IP cap for this door. */
    public const RATE_LIMITED = 'rate_limited';

    /** The token exchange failed, timed out, or returned an unusable token; also any
     * malformed or out-of-bounds claim, which is not the visitor's fault to explain. */
    public const PROVIDER = 'provider';

    public function __construct(public readonly string $failureCode) {
        parent::__construct('Google sign-in refused: ' . $failureCode);
    }
}
