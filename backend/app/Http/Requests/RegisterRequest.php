<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Support\PasswordPolicy;
use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Server-side registration rules. The password policy is no longer stated here:
     * 022 moved it to App\Support\PasswordPolicy, which registration, the recovery
     * reset, and the account-page change all consume — so recovery cannot drift from
     * registration. The rules themselves are unchanged (min 8, mixed case, a number;
     * the compromised-password check stays deferred — research D3/D4, D9).
     *
     * `unique:users,email` means a 422 confirms an account's existence — an accepted,
     * deliberate tradeoff (unlike login's generic 401): registration cannot proceed
     * against a taken address anyway, and the 5/min/IP throttle blunts bulk probing.
     * The enumeration-free alternative (accept the submission and email "you already
     * have an account") needs mail-product buy-in; revisit alongside password reset.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => PasswordPolicy::rules(),
        ];
    }
}
