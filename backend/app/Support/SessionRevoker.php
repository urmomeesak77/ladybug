<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Ends every other session for an account (FR-016, FR-028; research D6). Not
 * `Auth::logoutOtherDevices` — that needs the plaintext password, which the recovery
 * route never has, and only takes effect through `AuthenticateSession`'s next-request
 * check. A row deletion here is what actually invalidates a remembered sign-in
 * (018's "remember me" is a session-lifetime extension, not a separate token), and it
 * is immediate rather than waiting for that account's next request.
 */
final class SessionRevoker {
    public static function revoke(User $user, ?string $keepSessionId): void {
        $query = DB::table('sessions')->where('user_id', $user->id);

        if ($keepSessionId !== null) {
            $query->where('id', '!=', $keepSessionId);
        }

        $query->delete();
    }
}
