<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void {
        Schema::table('users', function (Blueprint $table) {
            // sha1(email), the only account handle a verification link carries
            // (no ids in URLs — 008 research D3). Indexed so a session-free
            // link click can find its account. Nullable only because the column
            // arrives after the rows; the model keeps it filled from here on.
            $table->string('email_sha1', 40)->nullable()->index();
        });

        // Backfill in PHP, not SQL: the digest must be computed identically on
        // MySQL (dev) and SQLite (tests), and SQLite has no sha1() function.
        foreach (DB::table('users')->whereNull('email_sha1')->get(['id', 'email']) as $row) {
            DB::table('users')->where('id', $row->id)->update(['email_sha1' => sha1((string) $row->email)]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['email_sha1']);
            $table->dropColumn('email_sha1');
        });
    }
};
