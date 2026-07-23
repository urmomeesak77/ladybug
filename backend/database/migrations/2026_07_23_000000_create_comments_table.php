<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void {
        // utf8mb4_bin collation and ON UPDATE CURRENT_TIMESTAMP exist only on
        // MySQL (runtime); SQLite (tests) degrades to portable equivalents,
        // mirroring the trashposts migration (data-model MySQL/SQLite split).
        $isMysql = Schema::getConnection()->getDriverName() === 'mysql';

        Schema::create('comments', function (Blueprint $table) use ($isMysql) {
            $table->id();
            $hash = $table->string('hash', 10)->unique();
            if ($isMysql) {
                $hash->collation('utf8mb4_bin');
            }
            // Cascade fires only on a real row delete (a purge), never on the parent's
            // soft delete — a soft-deleted post keeps its comments (data-model D4).
            $table->foreignId('trashpost_id')->constrained('trashposts')->cascadeOnDelete();
            // Nulls if the author account is later hard-deleted; the username snapshot below
            // then carries the display name (data-model D5).
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('username')->nullable();
            $table->text('body');
            // Presence marks the comment hidden from public view (still visible to admins);
            // absence is visible. No boolean flag to fall out of step (data-model D2).
            $table->timestamp('hidden_at')->nullable();
            $table->timestamp('created_at')->nullable()->useCurrent();
            $updated = $table->timestamp('updated_at')->nullable()->useCurrent();
            if ($isMysql) {
                $updated->useCurrentOnUpdate();
            }
            // Backs the newest-first keyset listing scoped to a single post.
            $table->index(['trashpost_id', 'created_at', 'id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::dropIfExists('comments');
    }
};
