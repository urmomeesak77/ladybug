<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * One row per HTTP request the application handled (FR-001). Rows are write-once:
     * inserted by AccessLogService::record() and never updated, which is why the table
     * has no `updated_at` — a column implying otherwise would invite one.
     */
    public function up(): void {
        Schema::create('access_logs', function (Blueprint $table) {
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

            // The ONLY secondary index, and it is here for the writer, not the reader:
            // prune() sweeps `WHERE created_at < cutoff LIMIT 1000` in a loop every
            // night, and without this each pass would full-scan the whole history.
            //
            // The five lookup indexes this table used to carry — on remote_addr,
            // forwarded_for, user_id, status and path — were deliberately dropped. The
            // history is read rarely and by hand, so their read benefit never justified
            // carrying a second copy of a table that grows with every request. Measured
            // before removing them (T034), they were not buying write speed either:
            // all six together cost 0.10ms of a 5.03ms insert, so this is a disk-space
            // decision, not a latency one. An operator's ad-hoc query scans instead.
            $table->index(['created_at', 'id']);
            // MySQL requires an index on a referencing column, so InnoDB creates a
            // single-column one on user_id for this constraint. That is expected, and
            // is why SHOW INDEX lists a user_id key nobody declared.
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::dropIfExists('access_logs');
    }
};
