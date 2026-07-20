<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Two nullable columns carry the disabled state. Nullable is the whole design:
     * the absence of a timestamp IS "active", so every existing account stays
     * enabled through this migration with no backfill (data-model §1).
     */
    public function up(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('disabled_at')->nullable();
            // Self-referencing: the moderator who disabled the account. nullOnDelete
            // so removing a moderator degrades the record to "actor unresolvable"
            // rather than blocking the delete or orphaning the row (INV-3).
            $table->foreignId('disabled_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    /**
     * The foreign key must be dropped before its column — SQLite (the test driver)
     * and MySQL both refuse to drop a constrained column otherwise.
     */
    public function down(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['disabled_by']);
            $table->dropColumn(['disabled_at', 'disabled_by']);
        });
    }
};
