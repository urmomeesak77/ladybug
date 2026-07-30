<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\UserIdentityFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserIdentity extends Model {
    /** @use HasFactory<UserIdentityFactory> */
    use HasFactory;

    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'user_identities';

    /**
     * Nothing is mass-assignable. `provider_user_id` is the sole key to an account,
     * so anything that could reach it through fill() from a request body would be an
     * account-takeover primitive of exactly the kind `role` and `rating` are kept out
     * of User::$fillable to avoid (data-model §1). IdentityLinkService assigns every
     * column explicitly.
     *
     * @var list<string>
     */
    protected $fillable = [];

    /**
     * Belt-and-braces for FR-022/INV-8: no resource serializes this model at all,
     * but the provider's subject must not travel even if one ever did.
     *
     * @var list<string>
     */
    protected $hidden = ['provider_user_id'];

    /**
     * Get the account this link belongs to. Never null in practice — the FK
     * cascades on delete, so a link cannot outlive its account (FR-032, INV-4).
     */
    public function user(): BelongsTo {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array {
        return [
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }
}
