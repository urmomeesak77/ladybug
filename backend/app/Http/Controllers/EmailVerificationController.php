<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\VerifyEmailRequest;
use App\Http\Resources\UserResource;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller {
    /**
     * Fulfill a verification link. Signature/expiry are enforced by the
     * signed:relative middleware and account binding by VerifyEmailRequest, so
     * only the state transition lives here. Idempotent: an already-verified
     * account is reported as such, never an error (FR-005).
     */
    public function verify(VerifyEmailRequest $request): JsonResponse {
        $user = $request->user();
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
