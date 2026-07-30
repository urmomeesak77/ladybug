<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * Rules for an own-account profile change. Only the display name is editable here —
     * e-mail, role and every other column stay out of reach of the request body.
     *
     * Unlike registration, the name must be unique: it is the handle other users see on
     * memes and comments, so two accounts may not answer to the same one. The current
     * account is excluded from the check so re-saving an unchanged name is not an error.
     * The route is behind auth:sanctum, so a user is always present.
     *
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'name' => [
                'required',
                'string',
                'max:255',
                Rule::unique('users', 'name')->ignore($this->user()->id),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array {
        return ['name.unique' => 'That name is already taken.'];
    }
}
