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
        Schema::table('trashposts', function (Blueprint $table) {
            // The rating model is now state-reflective (design 2026-07-21): every
            // adjustment fires on a real moderation transition, and idempotency comes
            // from ModerationService's state guards rather than a per-post ledger. The
            // two flag columns the ledger needed are no longer read anywhere.
            $table->dropColumn(['rating_credited', 'rating_penalized']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->boolean('rating_credited')->default(false)->after('activated_at');
            $table->boolean('rating_penalized')->default(false)->after('rating_credited');
        });
    }
};
