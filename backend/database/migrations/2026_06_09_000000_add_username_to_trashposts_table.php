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
        // Preserves the prototype's free-text author name (the legacy `user`
        // column) alongside the new `user_id` FK; nullable because most legacy
        // rows have no matching users record and new posts may be anonymous.
        Schema::table('trashposts', function (Blueprint $table) {
            $table->string('username')->nullable()->after('user_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn('username');
        });
    }
};
