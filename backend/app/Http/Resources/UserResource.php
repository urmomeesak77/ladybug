<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource {
    /**
     * Transform the user into its safe public representation. Only non-sensitive
     * fields are exposed — never the password hash or remember token (Principle VI).
     * The DB id never reaches clients — the account's public handle is its 10-char
     * hash (Principle V).
     *
     * The two sign-in-method fields (017, FR-029) are safe here only because this
     * resource is returned for the REQUESTER'S OWN account and nowhere else —
     * register, login, /api/user and the verification landing. Which doors an
     * account has is nobody else's business, and `provider_user_id` is disclosed
     * to no one at all (FR-022): `google_linked_at` is a timestamp, not an
     * identifier, and cannot be presented back to Google.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        return [
            'hash' => $this->hash,
            'name' => $this->name,
            'email' => $this->email,
            'email_verified_at' => $this->email_verified_at,
            'role' => $this->role->value,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'has_password' => $this->password !== null,
            'google_linked_at' => $this->googleIdentity?->created_at,
        ];
    }
}
