<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\OAuthFailure;
use App\Models\User;
use App\Models\UserIdentity;
use App\Support\GoogleIdentity;
use App\Utils\Str;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Decides which Ladybug account a Google-confirmed identity belongs to, creating one
 * if it belongs to none. The normative order is research D8 and its order is
 * load-bearing, not stylistic — each guard is only sound because of what runs before it.
 *
 * This class NEVER talks to Google (research D17). It is handed an identity that has
 * already been established and only ever reads and writes rows, which is what lets its
 * suite be pure database with no token endpoint to stub.
 */
class IdentityLinkService {
    private const PROVIDER = 'google';

    private const HASH_LENGTH = 10;

    /**
     * The account this identity signs in as.
     *
     * @throws OAuthFailure when the sign-in is refused, always before the first write
     */
    public function resolve(GoogleIdentity $identity): User {
        // Step 1, outside the transaction because it needs no row: an address Google
        // has not confirmed must never reach the matching rules below. This is the
        // load-bearing guard under the whole auto-link (FR-005, US3 AS5) — relax it and
        // anyone could claim a stranger's address at an identity provider and inherit
        // their account.
        if (! $identity->isEmailVerified) {
            throw new OAuthFailure(OAuthFailure::UNVERIFIED_EMAIL);
        }

        try {
            return $this->attempt($identity);
        }
        catch (UniqueConstraintViolationException) {
            // Research D8's concurrency backstop. The locks below serialize two flows
            // sharing a connection; two flows on two connections can still both find
            // nothing and both insert, and the unique indexes (D7) are what turns that
            // into a caught error rather than a duplicate account or a second link.
            //
            // The whole transaction is re-run rather than the statement retried, so the
            // half-built account of the losing attempt goes back with it — and re-run
            // exactly once, because a second violation is no longer a lost race but a
            // genuine fault, and looping on it would hang the request instead.
            return $this->attempt($identity);
        }
    }

    /** One run of steps 2–6 under one transaction. */
    private function attempt(GoogleIdentity $identity): User {
        return DB::transaction(fn (): User => $this->resolveLocked($identity));
    }

    /**
     * Steps 2–6, inside one transaction so a second flow started in another tab blocks
     * on the same rows rather than racing them (research D8, US4 AS5).
     *
     * The account is read through `?->` and the return guarded on the RESULT being
     * non-null, rather than on the link being found. A found link always has its account,
     * because `user_id` is NOT NULL behind a cascading FK — research D8 calls that branch
     * unreachable — but Eloquent's relation is nullable regardless. Written this way an
     * ownerless link falls through along the very line the "no link at all" case already
     * takes, so the method is total with no statement no test can reach, and never a
     * TypeError on a `User` return type.
     */
    private function resolveLocked(GoogleIdentity $identity): User {
        // Step 2: recognition is by Google's stable `sub`, never by the address.
        $link = UserIdentity::where('provider', self::PROVIDER)
            ->where('provider_user_id', $identity->sub)
            ->lockForUpdate()
            ->first();

        // Step 3: the returning visitor. Once a link exists it is the whole answer and
        // the e-mail below is never consulted (FR-009, US3 AS3) — which is what makes the
        // collision rule un-re-enterable and SC-003 true: change the address at Google
        // and the same `sub` still resolves to the same account.
        $user = $link?->user;

        // (US5) the disabled guard on this path lands with the story that owns it, and
        // must sit here — above the return, below the lookup, before any write.

        if ($user !== null) {
            return $user;
        }

        // Step 4: the address collision. Locked exactly like the link above, so two
        // flows arriving on one address serialize rather than race — and reached only
        // because step 2 found nothing, which is what keeps a linked account off this
        // path forever after (FR-009).
        $holder = User::where('email', $identity->email)->lockForUpdate()->first();

        if ($holder !== null) {
            return $this->attach($holder, $identity);
        }

        // Step 6: nobody here by either door, so this is a new person.
        return $this->create($identity);
    }

    /**
     * Step 5: the account already holding this Google-confirmed address gains the link
     * and signs in — one person, one account, two doors (FR-011).
     *
     * The only writes on this path are the link insert and, conditionally, the
     * verification stamp (FR-015). The password, the role, the rating, the disabled
     * state, the uploads and the comments are not part of the rule and are not touched,
     * which is what makes SC-004 — the original password still signs in afterwards —
     * true by construction rather than by a test that happens to pass.
     */
    private function attach(User $user, GoogleIdentity $identity): User {
        // (US5) the disabled guard on this path lands with the story that owns it, and
        // must sit here — above the first write, so a refusal changes nothing.

        // FR-012, US3 AS6: one account, one Google account. Re-pointing an existing link
        // would hand whoever arrived second the keys to an account that is not theirs.
        if ($user->googleIdentity !== null) {
            throw new OAuthFailure(OAuthFailure::ALREADY_LINKED);
        }

        $this->link($user, $identity);

        // US3 AS4: conditional, because the stamp records when the address was FIRST
        // confirmed — an unconditional call would quietly rewrite it on every sign-in.
        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
        }

        return $user;
    }

    /**
     * A brand-new account and its link. Verified on the spot because Google just
     * confirmed the address (FR-013), and otherwise entirely ordinary: member role,
     * rating 0, not disabled, and no password at all (FR-010, FR-014).
     */
    private function create(GoogleIdentity $identity): User {
        $user = new User();
        $user->name = $identity->displayName();
        $user->email = $identity->email;
        // `hash` is not mass-assignable, so it is set explicitly (Principle V).
        $user->hash = Str::createUniqueHash(self::HASH_LENGTH);
        $user->save();

        // Through the framework's own method rather than by writing the column, so the
        // Verified event fires exactly as it does on the e-mail confirmation path.
        $user->markEmailAsVerified();

        $this->link($user, $identity);

        return $user;
    }

    /**
     * Attach the Google link. Written attribute by attribute because UserIdentity's
     * $fillable is deliberately empty — `provider_user_id` is the sole key to an
     * account, so a mass-assignable one would be an account-takeover primitive.
     */
    private function link(User $user, GoogleIdentity $identity): void {
        $link = new UserIdentity();
        $link->user_id = $user->id;
        $link->provider = self::PROVIDER;
        $link->provider_user_id = $identity->sub;
        $link->save();
    }
}
