<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * One row per HTTP request the application handled (FR-001). Rows are write-once:
     * inserted by AccessLogService::record() and never updated, which is why the table
     * has no `updated_at` — a column implying otherwise would invite one.
     */
    public function up(): void {
        // varchar(2048) under utf8mb4 is 8192 bytes, far past InnoDB's 3072-byte index
        // key limit, so `path` and `forwarded_for` can only carry PREFIX indexes on
        // MySQL. SQLite has neither the limit nor the syntax, so it takes the whole
        // column — the same driver split 2026_07_23_000000_create_comments_table.php uses.
        $isMysql = Schema::getConnection()->getDriverName() === 'mysql';

        Schema::create('access_logs', function (Blueprint $table) use ($isMysql) {
            $table->id();
            // The moment the request ARRIVED (captured in the recorder's before-phase),
            // not the moment the row was written, so ordering by it orders by arrival.
            $table->timestamp('created_at');
            // The peer address, straight off the connection. 45 chars is the IPv6
            // textual maximum (0000:...:255.255.255.255). Never empty.
            $table->string('remote_addr', 45);
            // X-Forwarded-For verbatim, chain and all. Empty string rather than NULL:
            // "the header was absent" without the three-valued-logic trap NULL brings
            // to WHERE forwarded_for <> ... queries (FR-002a).
            $table->string('forwarded_for', 255)->default('');
            $table->string('method', 10);
            // Query string excluded (Laravel's path()) — it lives in `query`, and
            // storing it twice would double the redaction surface for no gain.
            $table->string('path', 2048);
            $table->unsignedSmallInteger('status');
            // Microseconds as an integer, not a float: FR-009 wants sub-millisecond
            // resolution, and integers sort, sum and range-query without rounding.
            $table->unsignedBigInteger('duration_us');
            // Nullable on purpose: a StreamedResponse or BinaryFileResponse has no
            // content string and may carry no Content-Length. NULL means "not
            // measurable", which is honest where 0 would be a lie.
            $table->unsignedBigInteger('response_bytes')->nullable();
            // The account authenticated when the request ARRIVED (D2). NULL for
            // anonymous traffic and — per FR-008b — for sign-in, registration and
            // recovery-link resets, which arrive anonymous however they end.
            $table->foreignId('user_id')->nullable();
            $table->string('user_agent', 1024)->nullable();
            $table->string('referer', 2048)->nullable();
            // NULL, not {}, when there was nothing to record: an absent cookie header
            // and an empty cookie jar are the same thing to an operator, and NULL
            // keeps the row smaller.
            $table->json('query')->nullable();
            $table->json('input')->nullable();
            $table->json('cookies')->nullable();
            // [{field, name, mime, size}] per upload — never the bytes (FR-017).
            $table->json('files')->nullable();
            // longtext, not text: the default per-value cap is 65536 bytes and TEXT
            // holds 65535, so a value truncated at the limit plus its marker would
            // overflow TEXT by design — and 'strict' => true turns that into a lost row.
            $table->longText('body')->nullable();

            // Each composite leads with the filter column and trails created_at, so the
            // time-range half of every SC-008 question is answered by the index rather
            // than by a filesort.
            $table->index(['created_at', 'id']);
            $table->index(['remote_addr', 'created_at']);
            // Declared BEFORE the foreign key below so MySQL adopts it as the FK's
            // required index instead of silently creating a second one — six indexes
            // are already the dominant term in the SC-002 write budget.
            $table->index(['user_id', 'created_at']);
            $table->index(['status', 'created_at']);
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();

            if (!$isMysql) {
                $table->index(['forwarded_for', 'created_at']);
                $table->index(['path', 'created_at']);
            }
        });

        if ($isMysql) {
            // Named exactly as Blueprint would name them, so the two drivers stay
            // interchangeable to anything that reads the schema back.
            DB::statement(
                'CREATE INDEX access_logs_forwarded_for_created_at_index '
                . 'ON access_logs (forwarded_for(64), created_at)'
            );
            DB::statement(
                'CREATE INDEX access_logs_path_created_at_index '
                . 'ON access_logs (path(191), created_at)'
            );
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::dropIfExists('access_logs');
    }
};
