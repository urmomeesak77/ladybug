<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateCommentRequest extends FormRequest {
    /**
     * Authorisation is the route middleware's job (auth:sanctum + verified) — a request that
     * reaches here is already a verified signed-in account, so the form request only validates
     * the body (D8).
     */
    public function authorize(): bool {
        return true;
    }

    /**
     * Trim the body before validation so an all-whitespace comment collapses to '' and is
     * caught by `required` (FR-007), and stored bodies never carry leading/trailing padding.
     */
    protected function prepareForValidation(): void {
        if ($this->has('body')) {
            $this->merge(['body' => trim((string) $this->input('body'))]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array {
        // Non-empty after trim (FR-007) and at most 1000 chars (FR-008). Stored verbatim and
        // escaped on output as plain text — no server-side sanitisation (D10).
        return [
            'body' => ['required', 'string', 'max:1000'],
        ];
    }
}
