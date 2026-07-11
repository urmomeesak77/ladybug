<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Server-side registration rules. The password policy mirrors the prototype
     * (min 8, mixed case, a number); the compromised-password check is deferred as
     * it requires an external service (research D3/D4).
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
            'password' => ['required', 'string', 'confirmed', Password::min(8)->mixedCase()->numbers()],
        ];
    }
}
