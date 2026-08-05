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
        // Stores a video post's extracted poster-still filename ({hash}.jpg),
        // resolved through the existing image tree/size-variant machinery
        // (data-model.md). Nullable: irrelevant to image/YouTube posts. No index
        // — never queried on.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->string('poster')->nullable()->after('file');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn('poster');
        });
    }
};
