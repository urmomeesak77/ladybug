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
        ];
    }
}
