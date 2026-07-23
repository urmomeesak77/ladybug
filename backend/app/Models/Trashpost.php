<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\TrashpostFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Trashpost extends Model {
    /** @use HasFactory<TrashpostFactory> */
    use HasFactory;
    use SoftDeletes;

    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'trashposts';

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'title',
        'file',
        'type',
        'metadata',
        'comment',
    ];

    /**
     * Get the owning user, or null for an unowned post.
     */
    public function user(): BelongsTo {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the comments posted on this trashpost. Removed by the FK cascade when the post
     * is purged (hard-deleted), retained across a soft delete (data-model D4).
     */
    public function comments(): HasMany {
        return $this->hasMany(Comment::class);
    }

    /**
     * The public (non-hidden) comments only — the same set CommentService counts as the public
     * `total`. Kept as its own relation so the feed can aggregate it with withCount and no closure.
     */
    public function publicComments(): HasMany {
        return $this->comments()->whereNull('hidden_at');
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
            'activated_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }
}
