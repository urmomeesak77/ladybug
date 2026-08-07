<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Support\PasswordPolicy;
use Illuminate\Foundation\Http\FormRequest;

class UpdatePasswordRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Rules for the own-account password change (022, US3). The route is behind
     * auth:sanctum, so a user is always present and the account edited is always the
     * requester's own — there is no target parameter to point at somebody else's.
     *
     * `password` is `PasswordPolicy::rules()`, the same array registration and recovery
     * validate against: one policy, so the account page cannot be stricter or looser than
     * the rule the account was created under (FR-029, research D9).
     *
     * `current_password` is added by a plain `if` rather than a rule callback (conventions:
     * prefer closure-free alternatives). For an account with no stored credential — one
     * created through Google — the key is ABSENT from the array entirely, not present and
     * optional: a value submitted for it is ignored rather than checked, so there is nothing
     * to leave blank or guess at (FR-031). The live session is the proof of identity there;
     * for everyone else the current password is (FR-027).
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        $rules = ['password' => PasswordPolicy::rules()];

        if ($this->user()->password !== null) {
            $rules['current_password'] = ['required', 'current_password'];
        }

        return $rules;
    }
}
