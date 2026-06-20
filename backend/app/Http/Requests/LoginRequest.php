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
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ];
    }
}
