<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\TrashpostFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
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
