<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CheckResetTokenRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Presence only. Neither part is shape-checked here: a 422 that distinguished a
     * well-formed digest from a malformed one, or a 40-hex token from a 64-hex one,
     * would answer a question the single 403 refusal exists to leave unanswered
     * (FR-015, INV-7). Whether the pair names a live link is decided in one place,
     * PasswordService::checkResetToken.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'hash' => ['required', 'string'],
            'token' => ['required', 'string'],
        ];
    }
}
