<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccessLog extends Model {
    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'access_logs';

    /**
     * An entry is write-once, so there is no `updated_at` column to maintain. `created_at`
     * is the moment the request arrived — captured in the recorder's before-phase and
     * assigned explicitly — not the moment the row was written, so Eloquent must not
     * overwrite it with now() on save.
     *
     * @var bool
     */
    public $timestamps = false;

    /**
     * There is deliberately no $fillable: AccessLogService assigns every property
     * directly (research D9). A machine-built row has no reason to accept a
     * request-shaped array, so the model stays fully guarded.
     */

    /**
     * Get the account that made the request, or null for anonymous traffic and for
     * accounts hard-deleted since (nullOnDelete).
     *
     * Declared for the convenience of a future viewer (FR-031). Nothing in this feature
     * loads it — the recorder writes a raw id and never touches the `users` table, which
     * keeps the critical-path write to a single INSERT.
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
            'query' => 'array',
            'input' => 'array',
            'cookies' => 'array',
            'files' => 'array',
        ];
    }
}
