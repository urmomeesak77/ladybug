<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class VerifyEmailRequest extends FormRequest {
    /**
     * Bind the link to the account without any id in the URL (research D3): the
     * {hash} segment must be the sha1 digest of the *authenticated* user's own
     * email. A different signed-in user fails this check (403), which covers
     * cross-account link use. Replaces the stock EmailVerificationRequest,
     * which requires the user's DB id in the path.
     */
    public function authorize(): bool {
        $user = $this->user();

        if ($user === null) {
            return false;
        }

        return hash_equals(sha1((string) $user->getEmailForVerification()), (string) $this->route('hash'));
    }

    /**
     * The link carries everything in the path/query; there is no body to validate.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [];
    }
}
