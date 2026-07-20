<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Role;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable implements MustVerifyEmail {
    /** @use HasFactory<UserFactory> */
    use HasFactory;
    use Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    /**
     * The model's default attribute values. Pins every new account to member
     * (FR-004) — `role` is deliberately absent from $fillable so no request body
     * can set or escalate it (privilege-escalation guard, Principle VI).
     *
     * `rating` is absent from $fillable for the same reason (FR-003): it is the
     * sole input to auto-activation, so a request body that could reach it via
     * fill() would let anyone hand themselves the trust threshold and bypass
     * moderation. Only RatingService writes it. Its DB default (0) covers new
     * rows, so it needs no entry here.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'role' => Role::Member->value,
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Keep the sha1 digest of the address in step with the address itself. The
     * digest is the only account handle a verification link carries (no ids in
     * URLs — 008 research D3), so it must be resolvable back to the account
     * even without a session.
     */
    public function setEmailAttribute(string $value): void {
        $this->attributes['email'] = $value;
        $this->attributes['email_sha1'] = sha1($value);
    }

    /**
     * Get the posts owned by the user.
     */
    public function posts(): HasMany {
        return $this->hasMany(Trashpost::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'role' => Role::class,
        ];
    }
}
