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
            // thumbnailShared() runs a where(youtube_thumbnail) on every YouTube
            // purge/visibility sync; unindexed it is a full-table scan.
            $table->index('youtube_thumbnail');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropIndex(['youtube_thumbnail']);
        });
    }
};
