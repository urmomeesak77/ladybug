<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\VerifyEmailRequest;
use App\Http\Resources\UserResource;
use App\Services\UserService;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller {
    /**
     * Fulfill a verification link. Signature/expiry are enforced by the
     * signed:relative middleware and account binding by VerifyEmailRequest, so
     * only account resolution and the state transition live here. The route is
     * session-free: an anonymous click resolves the account from the link's
     * own email digest. Idempotent: an already-verified account is reported as
     * such, never an error (FR-005).
     */
    public function verify(VerifyEmailRequest $request, UserService $users): JsonResponse {
        $user = $request->user('sanctum')
            ?? $users->findByEmailDigest((string) $request->route('hash'));

        if ($user === null) {
            // Validly signed but pointing at no account (deleted, or address
            // changed since the mail went out): dead link, same as any other (FR-004).
            abort(403);
        }

        $alreadyVerified = $user->hasVerifiedEmail();

        if (! $alreadyVerified && $user->markEmailAsVerified()) {
            // Verified is the framework's hook point; nothing listens today, but
            // firing it keeps the flow standard for future listeners.
            event(new Verified($user));
        }

        return (new UserResource($user))
            ->additional(['meta' => ['already_verified' => $alreadyVerified]])
            ->response();
    }

    /**
     * Send a fresh verification message to the authenticated user (US2). Refused
     * with 409 when there is nothing to verify, so the SPA can tell the user
     * instead of silently mailing nothing. Unlike verify, resending is not
     * idempotent-OK: the contract distinguishes "sent" from "nothing to send".
     */
    public function send(Request $request): JsonResponse {
        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Email already verified.'], 409);
        }

        $user->sendEmailVerificationNotification();

        return response()->json(['message' => 'Verification link sent.']);
    }
}
