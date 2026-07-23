<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\CommentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Comment extends Model {
    /** @use HasFactory<CommentFactory> */
    use HasFactory;

    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'comments';

    /**
     * Only the body is mass-assignable. `hash`, `trashpost_id`, `user_id`, `username`, and
     * `hidden_at` are assigned explicitly by CommentService, never from a request body
     * (integrity/privilege guard, Principle VI — the same rule Trashpost applies to its
     * hash/user_id).
     *
     * @var list<string>
     */
    protected $fillable = ['body'];

    /**
     * Get the post this comment belongs to.
     */
    public function trashpost(): BelongsTo {
        return $this->belongsTo(Trashpost::class);
    }

    /**
     * Get the authoring account, or null once that account is hard-deleted (nullOnDelete).
     */
    public function user(): BelongsTo {
        return $this->belongsTo(User::class);
    }

    /**
     * Whether the comment is hidden from public view. The timestamp's presence is the
     * state — there is no separate boolean flag to fall out of step with it.
     */
    public function isHidden(): bool {
        return $this->hidden_at !== null;
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
            'hidden_at' => 'datetime',
        ];
    }
}
