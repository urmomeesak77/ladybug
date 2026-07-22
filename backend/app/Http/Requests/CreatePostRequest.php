<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Utils\Youtube;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Server-side rules for creating a post (Principle VI). A title is required (trimmed, so a
 * whitespace-only title is refused); exactly one of an uploaded image or a YouTube link is
 * required; the image must be a real, bounded jpg/png/gif and the YouTube value must parse to
 * a valid id. Authorization is the route's auth:sanctum middleware.
 */
class CreatePostRequest extends FormRequest {
    public function authorize(): bool {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array {
        return [
            'title' => ['required', 'string', 'max:255'],
            'image' => ['required_without:youtube', 'image', 'mimes:jpg,jpeg,png,gif', 'max:10240'],
            'youtube' => ['required_without:image', 'string', 'max:500'],
        ];
    }

    public function withValidator(Validator $validator): void {
        $validator->after($this->validateExclusivity(...));
    }

    /**
     * Cross-field rules the per-field rules() can't express: the image/YouTube inputs are
     * mutually exclusive, and any supplied YouTube link must parse to a real id.
     */
    private function validateExclusivity(Validator $validator): void {
        if ($this->hasFile('image') && filled($this->input('youtube'))) {
            $validator->errors()->add('image', 'Provide either an image or a YouTube link, not both.');
        }
        if (filled($this->input('youtube')) && Youtube::extractId((string) $this->input('youtube')) === null) {
            $validator->errors()->add('youtube', 'Enter a valid YouTube link.');
        }
    }
}
