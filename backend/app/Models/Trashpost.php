<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\TrashpostFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Trashpost extends Model {
    /** @use HasFactory<TrashpostFactory> */
    use HasFactory;
    use SoftDeletes;

    /** The upload is staged and waiting for (or inside) the queue worker (024). */
    public const MEDIA_PROCESSING = 'processing';

    /** The media exists on disk; the only state a post can be public in. */
    public const MEDIA_READY = 'ready';

    /** Processing failed and its partial files were removed; never public. */
    public const MEDIA_FAILED = 'failed';

    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'trashposts';

    /**
     * Mirrors the column default, so an instance built in PHP reads `ready` before it is ever
     * reloaded — otherwise isPubliclyVisible() would see null on a model fresh from save().
     * media_state and media_source are absent from $fillable: only the upload path and the
     * queue job move a post between states.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'media_state' => self::MEDIA_READY,
    ];

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'title',
        'file',
        'poster',
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
     * The feature's SINGLE definition of "publicly visible": activated, its media ready
     * (024 — a post still being processed, or whose processing failed, is never public
     * even if something activated it), and — via SoftDeletes' own global scope — not trashed. Every public reader goes through
     * here (the feed via TrashpostService::visible(), the sitemap, the shell's
     * metadata), so the archive a crawler is offered and the archive a visitor can
     * browse cannot drift apart.
     *
     * @param  Builder<Trashpost>  $query
     * @return Builder<Trashpost>
     */
    public function scopePubliclyVisible(Builder $query): Builder {
        return $query->whereNotNull('activated_at')->where('media_state', self::MEDIA_READY);
    }

    /**
     * The row-level twin of scopePubliclyVisible, for a post already loaded (the permalink
     * check). Kept beside the scope so the two definitions cannot drift apart.
     */
    public function isPubliclyVisible(): bool {
        return $this->activated_at !== null && $this->media_state === self::MEDIA_READY && ! $this->trashed();
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array {
        return [
            'youtube_is_short' => 'boolean',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'activated_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }
}
