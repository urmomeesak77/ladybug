<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use App\Support\SessionRevoker;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Throwable;

/**
 * Every decision the password feature makes, in one place (022).
 *
 * The one property worth guarding when editing this class: an ineligible request and a
 * successful one must leave the caller with the same information — which here means no
 * information at all. That is why the method below returns void.
 */
class PasswordService {
    public function __construct(private readonly UserService $users) {
    }

    /**
     * Mail a recovery link, if and only if the address names a real, enabled account that
     * is not inside the broker's re-send interval.
     *
     * FR-004 is carried by this signature, not by a convention: there is no status for the
     * controller to branch on, so an account-existence oracle cannot be reintroduced by a
     * later edit. Every non-sendable case — unknown address, disabled account (FR-006),
     * broker RESET_THROTTLED (FR-009), mail transport failure (FR-032) — leaves through the
     * same `return`, and the controller answers one unconditional 200 (research D4).
     *
     * The disabled check has to live HERE, above the broker: EloquentUserProvider resolves
     * accounts by credentials and knows nothing about `disabled_at`, so the broker would
     * happily mail a revoked account.
     *
     * A transport failure is reported and swallowed, exactly as registration's verification
     * mail already is (research D5). Not catching it would answer 500 for a real account and
     * 200 for an unknown one — the sharpest enumeration oracle the feature could ship.
     */
    public function sendRecoveryLink(string $email): void {
        $user = User::where('email', $email)->first();
        if ($user === null || $user->isDisabled()) {
            return;
        }

        try {
            // The broker's status string is discarded on purpose — see above.
            Password::sendResetLink(['email' => $email]);
        }
        catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * Is this link still usable? A pure READ — it creates nothing, refreshes nothing and
     * consumes nothing (FR-012), so an inbox scanner or a mail client's link preview
     * leaves the link exactly as it found it.
     *
     * Called once when the page opens, so a dead link is refused before the holder types a
     * password rather than after (US4 scenario 1, research D8).
     *
     * Every refusal returns the same `false`: unknown digest, disabled account, expired,
     * consumed, superseded, tampered. The caller has one refusal to render and therefore
     * cannot leak which of them it was (FR-015, INV-7).
     */
    public function checkResetToken(string $hash, string $token): bool {
        $user = $this->recoverableAccount($hash);
        if ($user === null) {
            return false;
        }

        return Password::getRepository()->exists($user, $token);
    }

    /**
     * Spend the link and set the new password.
     *
     * The account is resolved from the link's own digest, never from `$request->user()`:
     * a signed-in visitor opening someone else's link changes THAT account, not their own
     * (research D11, FR-016).
     *
     * The password is NOT judged here — `ResetPasswordRequest` did that, before the broker
     * saw the token. That ordering is what keeps a rejected password from spending a good
     * link (US2 scenarios 3–4).
     *
     * One transaction spans the broker call, so the credential write, the session
     * revocation and the token's deletion — which the broker performs after the callback
     * returns — land together or not at all (data-model §4, INV-3). `applyNewPassword`'s
     * `$keepSessionId` defaults to null here (this route keeps no session at all, FR-021),
     * which is why the broker's own 2-argument callback can call it unmodified.
     */
    public function reset(string $hash, string $token, string $password): bool {
        $user = $this->recoverableAccount($hash);
        if ($user === null) {
            return false;
        }

        DB::beginTransaction();
        try {
            $status = Password::broker()->reset([
                'email' => $user->email,
                'password' => $password,
                'password_confirmation' => $password,
                'token' => $token,
            ], $this->applyNewPassword(...));
            DB::commit();
        }
        catch (Throwable $exception) {
            DB::rollBack();
            throw $exception;
        }

        return $status === Password::PASSWORD_RESET;
    }

    /**
     * Change the password of an account that is already signed in (US3). No link, no inbox
     * and no waiting: the session names the account and `UpdatePasswordRequest` has already
     * proved the current password — or established that there is none to prove.
     *
     * The write goes through the SAME `applyNewPassword` the recovery route uses, so neither
     * route can grow a step the other lacks.
     *
     * Deleting any outstanding recovery token is FR-008's second half: an owner who suspects
     * their inbox is compromised has one lever that does not require reaching the inbox, and
     * this is it — changing the password here shuts a link an attacker has already asked for.
     * It shares the write's transaction, so a link is never left alive beside a password it
     * no longer belongs to (INV-3).
     *
     * `$keepSessionId` is the acting session — session()->getId() at the call site — so the
     * owner who just proved their own current password is not signed out by the change they
     * made (FR-028), unlike the recovery route, which keeps none.
     */
    public function change(User $user, string $password, ?string $keepSessionId): User {
        DB::beginTransaction();
        try {
            $this->applyNewPassword($user, $password, $keepSessionId);
            Password::broker()->deleteToken($user);
            DB::commit();
        }
        catch (Throwable $exception) {
            DB::rollBack();
            throw $exception;
        }

        return $user;
    }

    /**
     * The one place either route writes a credential, so neither can grow a step the other
     * lacks — including the after-effects FR-016/FR-028 require: every OTHER session for the
     * account ends, and `remember_token` is rotated as defence in depth (research D6).
     *
     * Assigned, not pre-hashed: the model's `hashed` cast does the hashing on save, and
     * handing it an already-hashed value would double-hash it and lock the holder out of the
     * password they just chose (data-model §2).
     *
     * `$keepSessionId` defaults to null so `reset()` can pass this method straight to the
     * broker's 2-argument callback (research D6) — the recovery route never has a session to
     * spare, so the default IS its behaviour, not a placeholder for one.
     */
    private function applyNewPassword(User $user, string $password, ?string $keepSessionId = null): void {
        $user->password = $password;
        $user->remember_token = Str::random(60);
        $user->save();
        SessionRevoker::revoke($user, $keepSessionId);
    }

    /**
     * The account a recovery link names, or null when the link can lead nowhere.
     *
     * The disabled check lives here rather than in the broker for the same reason it does on
     * the request route: EloquentUserProvider resolves accounts by credentials and knows
     * nothing about `disabled_at`, so the broker would honour a revoked account's link
     * (FR-006, INV-4).
     */
    private function recoverableAccount(string $hash): ?User {
        $user = $this->users->findByEmailDigest($hash);
        if ($user === null || $user->isDisabled()) {
            return null;
        }

        return $user;
    }
}
