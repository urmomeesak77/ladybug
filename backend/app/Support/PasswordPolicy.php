<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Validation\Rules\Password;

/**
 * The one server-side statement of what makes an acceptable password: min 8, mixed
 * case, at least one number, typed twice (research D9).
 *
 * Before 022 this rule set lived only in RegisterRequest. Recovery and the account-page
 * change would have made it four statements of the same policy, each free to drift from
 * the others — so it is stated here once and consumed by every request that accepts a
 * password. `PasswordModel.policyErrors` on the frontend mirrors it for instant feedback;
 * this class remains the authority (Principle VI).
 *
 * The compromised-password check (`uncompromised()`) stays deferred: it calls an external
 * service on every submission, which is a dependency decision, not a rule change.
 */
final class PasswordPolicy {
    /**
     * @return array<int, mixed>
     */
    public static function rules(): array {
        return ['required', 'string', 'confirmed', Password::min(8)->mixedCase()->numbers()];
    }
}
