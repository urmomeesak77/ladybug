<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use App\Utils\Str;
use Illuminate\Database\UniqueConstraintViolationException;

class UserService {
    private const HASH_LENGTH = 10;

    private const MAX_ATTEMPTS = 3;

    /**
     * Create a user from validated registration data. The password is stored hashed
     * (via the User model's `hashed` cast) and a unique 10-char public hash is minted.
     *
     * Email uniqueness is enforced upstream by RegisterRequest; the retry loop exists
     * only for the astronomically rare public-hash collision (the column is unique).
     *
     * @param  array{name: string, email: string, password: string}  $data
     */
    public function create(array $data): User {
        for ($attempt = 1; ; $attempt++) {
            try {
                return $this->persist($data);
            } catch (UniqueConstraintViolationException $e) {
                if ($attempt >= self::MAX_ATTEMPTS) {
                    throw $e;
                }
            }
        }
    }

    /**
     * @param  array{name: string, email: string, password: string}  $data
     */
    private function persist(array $data): User {
        $user = new User();
        $user->name = $data['name'];
        $user->email = $data['email'];
        // Assigned then cast-hashed on save; the password is never stored in plaintext.
        $user->password = $data['password'];
        // `hash` is not mass-assignable, so it is set explicitly (Principle V identifier).
        $user->hash = Str::createUniqueHash(self::HASH_LENGTH);
        $user->save();

        return $user;
    }
}
