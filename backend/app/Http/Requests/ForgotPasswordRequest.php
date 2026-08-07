<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ForgotPasswordRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Shape only: is this a well-formed address at all (FR-003)?
     *
     * There is deliberately NO `exists:users,email` rule here. It would be the account-
     * existence oracle FR-004 forbids — a 422 for an address with no account and a 200
     * for one with, which is precisely the distinction the whole feature is built to
     * withhold. Validation must not know more than the response is allowed to say, so
     * every well-formed address passes and the single collapse point in PasswordService
     * decides what actually happens (research D4).
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'email' => ['required', 'email', 'max:255'],
        ];
    }
}
