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
            // Signed, because a rating goes negative as easily as positive
            // (FR-011): a penalised account must be able to sit below zero
            // rather than wrap or clamp at an unsigned floor. DEFAULT 0 both
            // opens new accounts at zero (FR-001) and backfills every account
            // that predates the rating in the same DDL step (FR-002).
            // RatingService::MIN/MAX mirror this column's bounds.
            $table->smallInteger('rating')->default(0)->after('role');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('rating');
        });
    }
};
