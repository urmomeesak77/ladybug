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
        // Uploads are processed by the queue worker now (024), so a post exists before its
        // media does. media_state is processing | ready | failed; its `ready` default IS the
        // correct value for every pre-existing row, so no backfill. media_source is the staged
        // upload's path on the private disk while the worker has yet to run (data-model.md).
        // No index: the feed's own index already narrows to activated rows, every one of which
        // is ready, so the extra predicate never widens a scan.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->string('media_state', 16)->default('ready')->after('poster');
            $table->string('media_source')->nullable()->after('media_state');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn(['media_state', 'media_source']);
        });
    }
};
