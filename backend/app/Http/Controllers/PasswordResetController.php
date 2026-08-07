<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\ForgotPasswordRequest;
use App\Services\PasswordService;
use Illuminate\Http\JsonResponse;

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
}
