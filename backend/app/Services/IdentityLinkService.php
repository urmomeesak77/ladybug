<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\OAuthFailure;
use App\Models\User;
use App\Models\UserIdentity;
use App\Support\GoogleIdentity;
use App\Utils\Str;
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

        return DB::transaction(fn (): User => $this->resolveLocked($identity));
    }

    /**
     * Steps 2–6, inside one transaction so a second flow started in another tab blocks
     * on the same rows rather than racing them (research D8, US4 AS5).
     */
    private function resolveLocked(GoogleIdentity $identity): User {
        // Step 2: recognition is by Google's stable `sub`, never by the address.
        $link = UserIdentity::where('provider', self::PROVIDER)
            ->where('provider_user_id', $identity->sub)
            ->lockForUpdate()
            ->first();

        // Step 3 (US2) — the returning visitor, and the disabled guard on that path.
        // Deliberately left for the story that owns it; the branch belongs here.

        // Steps 4–5 (US3) — the address collision: the account holding this address
        // gains the link, unless it is disabled or already linked elsewhere.

        // Step 6: nobody here by either door, so this is a new person.
        return $this->create($identity);
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
