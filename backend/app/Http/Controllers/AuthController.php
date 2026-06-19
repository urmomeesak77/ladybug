<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Http\Requests\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller {
    public function __construct(private readonly UserService $users) {
    }

    /**
     * Register a new account and log it in (Sanctum SPA session). Returns the safe
     * public profile with 201. Validation failures are handled by RegisterRequest (422).
     */
    public function register(RegisterRequest $request): JsonResponse {
        $user = $this->users->create($request->validated());

        Auth::login($user);
        // Rotate the session id after authenticating to prevent session fixation.
        $request->session()->regenerate();

        return (new UserResource($user))->response()->setStatusCode(201);
    }
}
