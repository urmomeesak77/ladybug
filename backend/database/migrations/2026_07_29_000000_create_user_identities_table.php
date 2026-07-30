<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * The association between one Ladybug account and one external identity
     * (data-model §1). Both directions of FR-012 are unique indexes rather than
     * service-level checks: application code can be raced, an index cannot.
     */
    public function up(): void {
        Schema::create('user_identities', function (Blueprint $table) {
            $table->id();
            // cascadeOnDelete is deliberately the OPPOSITE of feature 013's
            // nullOnDelete on trashposts.user_id / comments.user_id: an orphaned
            // meme is still a meme, but an ownerless link matches nobody, can be
            // cleared by nobody, and would make UNIQUE (provider, provider_user_id)
            // permanently refuse its own person a new account. FR-032 exists to
            // prevent exactly that, and the FK is how it is enforced.
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // 'google' today; the column is what keeps a second provider possible.
            $table->string('provider', 32);
            // Google's `sub`. As internal as the database id — never serialized,
            // never in a URL, never logged (FR-022, INV-8).
            $table->string('provider_user_id', 255);
            $table->timestamps();
            // FR-012 direction A: one Google account → at most one Ladybug account.
            $table->unique(['provider', 'provider_user_id']);
            // FR-012 direction B: one Ladybug account → at most one Google account.
            // Left-prefixed by user_id, so lookups and the FK both use it — no
            // separate index on user_id is needed.
            $table->unique(['user_id', 'provider']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void {
        Schema::dropIfExists('user_identities');
    }
};
