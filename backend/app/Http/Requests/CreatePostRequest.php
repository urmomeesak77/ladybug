<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\Rules\ValidVideo;
use App\Utils\Youtube;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Server-side rules for creating a post (Principle VI). A title is required (trimmed, so a
 * whitespace-only title is refused); exactly one of an uploaded image, a YouTube link, or an
 * uploaded video is required; the image must be a real, bounded jpg/png/gif/webp, the video
 * must be a real, bounded, decodable mp4/webm, and the YouTube value must parse to a valid id.
 * Authorization is the route's auth:sanctum middleware.
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
            'image' => ['required_without_all:youtube,video', 'image', 'mimes:jpg,jpeg,png,gif,webp', 'max:10240'],
            'youtube' => ['required_without_all:image,video', 'string', 'max:500'],
            'video' => ['required_without_all:image,youtube', 'mimetypes:video/mp4,video/webm', 'max:20480', new ValidVideo()],
        ];
    }

    public function withValidator(Validator $validator): void {
        $validator->after($this->validateExclusivity(...));
    }

    /**
     * Cross-field rules the per-field rules() can't express: the image/YouTube/video inputs
     * are mutually exclusive (any two or three present is rejected on each present field), and
     * any supplied YouTube link must parse to a real id.
     */
    private function validateExclusivity(Validator $validator): void {
        $present = array_filter([
            'image' => $this->hasFile('image'),
            'youtube' => filled($this->input('youtube')),
            'video' => $this->hasFile('video'),
        ]);
        if (count($present) > 1) {
            foreach (array_keys($present) as $field) {
                $validator->errors()->add($field, 'Provide only one of an image, a YouTube link, or a video, not more than one.');
            }
        }
        if (filled($this->input('youtube')) && Youtube::extractId((string) $this->input('youtube')) === null) {
            $validator->errors()->add('youtube', 'Enter a valid YouTube link.');
        }
    }
}
