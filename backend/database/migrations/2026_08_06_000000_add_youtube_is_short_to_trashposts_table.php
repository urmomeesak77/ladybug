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
        // Records whether the raw submitted link was a youtube.com/shorts/ URL — the
        // only moment that shape is known, since validation discards it down to a bare
        // 11-char id — so playback can use a 9:16 player instead of letterboxing the
        // clip in the wide box (data-model.md). Non-nullable with a false default: that
        // IS the correct historical value for every pre-existing row, so no backfill.
        // No index — never queried on, only read back for display.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->boolean('youtube_is_short')->default(false)->after('youtube');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn('youtube_is_short');
        });
    }
};
