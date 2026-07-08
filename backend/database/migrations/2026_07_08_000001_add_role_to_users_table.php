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
        Schema::table('users', function (Blueprint $table) {
            // Every account carries exactly one role. A plain NOT NULL string with
            // DEFAULT 'member' both pins new rows and backfills every pre-existing
            // account in one DDL step (FR-004/FR-010). No MySQL ENUM/CHECK: a plain
            // string keeps the migration identical on SQLite :memory: (research D3);
            // the closed set is enforced in the app layer by the Role enum cast.
            $table->string('role')->default('member')->after('password');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('role');
        });
    }
};
