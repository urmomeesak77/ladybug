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
        // Backs the read feed's keyset: WHERE ... ORDER BY activated_at DESC,
        // id DESC seeks on (activated_at, id) instead of scanning + filesorting
        // the whole table on every page. id mirrors the tie-break in the ORDER BY.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->index(['activated_at', 'id'], 'trashposts_feed_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropIndex('trashposts_feed_index');
        });
    }
};
