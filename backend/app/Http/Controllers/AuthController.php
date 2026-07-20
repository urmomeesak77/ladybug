<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Throwable;

class AuthController extends Controller {
    public function __construct(private readonly UserService $users) {
    }

    /**
     * Register a new account and log it in (Sanctum SPA session). Returns the safe
     * public profile with 201. Validation failures are handled by RegisterRequest (422).
     */
    public function register(RegisterRequest $request): JsonResponse {
        $user = $this->users->create($request->validated());

        // FR-011: a mail-transport failure must never fail registration — the
        // account exists and the resend endpoint is the recovery path, so the
        // error is reported server-side and the request proceeds.
        try {
            $user->sendEmailVerificationNotification();
        }
        catch (Throwable $exception) {
            report($exception);
        }

        Auth::login($user);
        // Rotate the session id after authenticating to prevent session fixation.
        $request->session()->regenerate();

        return (new UserResource($user))->response()->setStatusCode(201);
    }

    /**
     * Log a user in via the Sanctum SPA session. On bad credentials returns a single
     * generic 401 that does not reveal whether the email or password was wrong (D5).
     *
     * The disabled-account check runs AFTER credentials verify (research D4): only the true
     * owner ever learns the account is disabled, so the login form is not an account-state
     * oracle. A disabled account gets a distinct 403 and its just-established session torn
     * down; re-enabling restores sign-in with the same credentials (FR-013/FR-015).
     */
    public function login(LoginRequest $request): JsonResponse {
        if (! Auth::attempt($request->validated())) {
            return response()->json(['message' => 'These credentials do not match our records.'], 401);
        }

        if ($request->user()->isDisabled()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'This account is disabled.'], 403);
        }

        // Rotate the session id after authenticating to prevent session fixation.
        $request->session()->regenerate();

        return (new UserResource($request->user()))->response();
    }

    /**
     * Log the current user out: revoke the session and rotate the CSRF token so the
     * cleared session cannot be reused (route is protected by auth:sanctum).
     */
    public function logout(Request $request): JsonResponse {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Logged out.']);
    }

    /**
     * The current user's safe profile, or {data: null} when anonymous. Deliberately not
     * behind auth:sanctum: the SPA probes this on load to derive auth state, and "logged
     * out" must read as data:null (200), not an error (FR-005).
     */
    public function user(Request $request): JsonResponse {
        $user = $request->user();

        if ($user === null) {
            return response()->json(['data' => null]);
        }

        return (new UserResource($user))->response();
    }
}
