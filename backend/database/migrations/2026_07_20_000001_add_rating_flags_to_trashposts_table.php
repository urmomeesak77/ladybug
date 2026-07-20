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
            // The per-post ledger that makes every rating adjustment idempotent
            // (FR-006, FR-008): a post can only ever be credited once and
            // penalised once, no matter how often it is activated, deactivated,
            // deleted or restored. Both default false so pre-existing posts read
            // as uncredited/unpenalised — which is what makes a legacy activated
            // post release nothing it never earned (FR-002).
            $table->boolean('rating_credited')->default(false)->after('activated_at');
            $table->boolean('rating_penalized')->default(false)->after('rating_credited');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropColumn(['rating_credited', 'rating_penalized']);
        });
    }
};
