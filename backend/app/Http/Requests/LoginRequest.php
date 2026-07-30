<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Login validates only the shape of the input. Crucially there is NO
     * `exists:users,email` rule — an unknown email must fail identically to a wrong
     * password (a generic 401 from the controller) to prevent account enumeration (D5).
     *
     * `password` being `required` is guard 1 of FR-020: a passwordless (Google-only)
     * account stores `password` as NULL, and an absent, null or empty submitted
     * password is a 422 here that never reaches `Auth::attempt()`. Guard 2 is
     * `Hash::check`, which refuses a null hash anyway — the two are independent on
     * purpose, so neither one relaxing turns a NULL column into a way in.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ];
    }
}
