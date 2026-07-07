<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\VerifyEmailRequest;
use App\Http\Resources\UserResource;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;

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
}
