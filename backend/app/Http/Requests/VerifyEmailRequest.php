<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class VerifyEmailRequest extends FormRequest {
    /**
     * Bind the link to an account without any id in the URL (research D3).
     * Anonymous clicks pass: signed:relative already proved the server minted
     * the link, and the controller resolves the account from the digest itself.
     * With a session present, the {hash} segment must be the sha1 digest of
     * that user's own email — a different signed-in user fails this check
     * (403), which covers cross-account link use. Replaces the stock
     * EmailVerificationRequest, which requires the user's DB id in the path.
     */
    public function authorize(): bool {
        $user = $this->user('sanctum');

        if ($user === null) {
            return true;
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
