<?php

declare(strict_types=1);

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The admin-only account row (data-model §3): just what the user console needs to list and
 * act on an account. Deliberately omits the DB id, password, remember_token, email_sha1 and
 * rating — the hash is the only public handle (Principle V), and account internals never
 * leave the backend (Principle VI). This projection is reachable only from the admin console
 * (routes/api.php), never from a public or member-facing payload (FR-018).
 *
 * @mixin \App\Models\User
 */
class AdminUserResource extends JsonResource {
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array {
        return [
            'hash' => $this->hash,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->role->value,
            'email_verified_at' => $this->email_verified_at?->format('Y-m-d H:i:s'),
            'created_at' => $this->created_at?->format('Y-m-d H:i:s'),
            'disabled_at' => $this->disabled_at?->format('Y-m-d H:i:s'),
            // The acting account's NAME, never its id (INV-3). Null on an active account and
            // on a disabled row whose actor has since been deleted (nullOnDelete) — the
            // "unresolvable actor" edge case degrades to the timestamp alone.
            'disabled_by' => $this->disabledBy?->name,
        ];
    }
}
