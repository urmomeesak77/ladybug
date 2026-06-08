<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // utf8mb4_bin collation and ON UPDATE CURRENT_TIMESTAMP exist only on
        // MySQL (runtime); SQLite (tests) degrades to portable equivalents
        // without losing the asserted behaviour (research R2, R3).
        $isMysql = Schema::getConnection()->getDriverName() === 'mysql';

        Schema::create('trashposts', function (Blueprint $table) use ($isMysql) {
            $table->id();
            $hash = $table->string('hash', 10)->nullable()->unique();
            if ($isMysql) {
                $hash->collation('utf8mb4_bin');
            }
            $table->string('title')->nullable();
            $table->string('type')->nullable();
            $table->string('file')->nullable();
            $table->string('youtube')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('comment')->nullable();
            $table->text('metadata')->nullable();
            $table->timestamp('created_at')->nullable()->useCurrent();
            $updated = $table->timestamp('updated_at')->nullable()->useCurrent();
            if ($isMysql) {
                $updated->useCurrentOnUpdate();
            }
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('trashposts');
    }
};
