<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Password;
use Throwable;

/**
 * Every decision the password feature makes, in one place (022).
 *
 * The one property worth guarding when editing this class: an ineligible request and a
 * successful one must leave the caller with the same information — which here means no
 * information at all. That is why the method below returns void.
 */
class PasswordService {
    /**
     * Mail a recovery link, if and only if the address names a real, enabled account that
     * is not inside the broker's re-send interval.
     *
     * FR-004 is carried by this signature, not by a convention: there is no status for the
     * controller to branch on, so an account-existence oracle cannot be reintroduced by a
     * later edit. Every non-sendable case — unknown address, disabled account (FR-006),
     * broker RESET_THROTTLED (FR-009), mail transport failure (FR-032) — leaves through the
     * same `return`, and the controller answers one unconditional 200 (research D4).
     *
     * The disabled check has to live HERE, above the broker: EloquentUserProvider resolves
     * accounts by credentials and knows nothing about `disabled_at`, so the broker would
     * happily mail a revoked account.
     *
     * A transport failure is reported and swallowed, exactly as registration's verification
     * mail already is (research D5). Not catching it would answer 500 for a real account and
     * 200 for an unknown one — the sharpest enumeration oracle the feature could ship.
     */
    public function sendRecoveryLink(string $email): void {
        $user = User::where('email', $email)->first();
        if ($user === null || $user->isDisabled()) {
            return;
        }

        try {
            // The broker's status string is discarded on purpose — see above.
            Password::sendResetLink(['email' => $email]);
        }
        catch (Throwable $exception) {
            report($exception);
        }
    }
}
