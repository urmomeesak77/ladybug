<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Support\PasswordPolicy;
use Illuminate\Foundation\Http\FormRequest;

class ResetPasswordRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * The policy is `PasswordPolicy::rules()`, the same array registration validates
     * against — recovery cannot be stricter or looser than the rule the account was
     * created under (FR-013, FR-029, research D9).
     *
     * The ORDERING here is load-bearing, not incidental: form-request validation runs
     * BEFORE the controller, and therefore before the broker ever sees the token. That
     * is what makes a rejected password leave the link alive and reusable (US2 scenarios
     * 3–4) — a policy failure is a 422 that never reached the link at all, while a
     * rejected link is a 403 that changed nothing. Moving the policy check into the
     * service would collapse the two into one indistinguishable failure.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'hash' => ['required', 'string'],
            'token' => ['required', 'string'],
            'password' => PasswordPolicy::rules(),
        ];
    }
}
