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
        // Caches the relative path of the once-downloaded YouTube still so the
        // moderation table fetches each remote thumbnail at most once (SC-004);
        // nullable because it stays unset until the first successful fetch and is
        // irrelevant to non-YouTube posts.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->string('youtube_thumbnail')->nullable()->after('youtube');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn('youtube_thumbnail');
        });
    }
};
