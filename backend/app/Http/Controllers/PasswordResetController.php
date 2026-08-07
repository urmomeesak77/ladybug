<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\CheckResetTokenRequest;
use App\Http\Requests\ForgotPasswordRequest;
use App\Http\Requests\ResetPasswordRequest;
use App\Services\PasswordService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * The anonymous half of password recovery (022). None of these endpoints reads
 * $request->user(): the account in play is always the one the submitted address or digest
 * names, never the signed-in one (research D11).
 */
class PasswordResetController extends Controller {
    public function __construct(private readonly PasswordService $passwords) {
    }

    /**
     * Ask for a recovery link. Answers ONE 200 with ONE message for every well-formed
     * address — real account or not, enabled or not, inside the re-send interval or not,
     * mail transport working or not (FR-004, contracts/password-recovery-api.md §1).
     *
     * There is nothing to branch on here by construction: sendRecoveryLink() returns void
     * (research D4). If a future edit gives it a return value, this method is where the
     * enumeration oracle would reappear — so it should not.
     */
    public function request(ForgotPasswordRequest $request): JsonResponse {
        $this->passwords->sendRecoveryLink($request->validated()['email']);

        return response()->json([
            'message' => 'If an account exists for that address, a password recovery link is on its way.',
        ]);
    }

    /**
     * Is this link still alive? A read, answered before the holder types anything, so a dead
     * link is refused when it is OPENED rather than after a password has been composed twice
     * (US4 scenario 1). It consumes nothing (FR-012, contracts §2).
     */
    public function check(CheckResetTokenRequest $request): Response|JsonResponse {
        $input = $request->validated();
        if (! $this->passwords->checkResetToken($input['hash'], $input['token'])) {
            return $this->refusal();
        }

        return response()->noContent();
    }

    /**
     * Spend the link and set the new password. The account is the link's, never the
     * signed-in one (research D11), and no session is established — the caller is told to
     * log in, and means it (FR-021, INV-6).
     */
    public function reset(ResetPasswordRequest $request): JsonResponse {
        $input = $request->validated();
        if (! $this->passwords->reset($input['hash'], $input['token'], $input['password'])) {
            return $this->refusal();
        }

        return response()->json(['message' => 'Your password has been changed. Please log in.']);
    }

    /**
     * The single refusal, shared by both routes. Expired, consumed, superseded, tampered,
     * unknown, deleted and disabled all arrive here, so the response names no account detail
     * and gives no hint which part was wrong (FR-015, INV-7). One method, so a later edit
     * cannot make one route more talkative than the other.
     */
    private function refusal(): JsonResponse {
        return response()->json(['message' => 'This password recovery link is no longer valid.'], 403);
    }
}
