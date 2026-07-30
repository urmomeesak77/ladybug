<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Services\UserService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserServiceTest extends TestCase {
    use RefreshDatabase;

    private function data(array $overrides = []): array {
        return array_merge([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'Password1',
        ], $overrides);
    }

    public function test_it_persists_a_user_with_the_given_name_and_email(): void {
        $user = (new UserService())->create($this->data());

        $this->assertTrue($user->exists);
        $this->assertSame('Ada Lovelace', $user->name);
        $this->assertSame('ada@example.com', $user->email);
        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
    }

    public function test_it_stores_the_password_hashed_not_in_plaintext(): void {
        $user = (new UserService())->create($this->data(['password' => 'Password1']));

        $this->assertNotSame('Password1', $user->password);
        $this->assertTrue(Hash::check('Password1', $user->password));
    }

    public function test_it_mints_a_unique_ten_character_public_hash(): void {
        $first = (new UserService())->create($this->data(['email' => 'a@example.com']));
        $second = (new UserService())->create($this->data(['email' => 'b@example.com']));

        $this->assertSame(10, strlen((string) $first->hash));
        $this->assertSame(10, strlen((string) $second->hash));
        $this->assertNotSame($first->hash, $second->hash);
    }

    public function test_it_renames_a_user_and_persists_the_new_name(): void {
        $service = new UserService();
        $user = $service->create($this->data());

        $renamed = $service->rename($user, 'Grace Hopper');

        $this->assertSame('Grace Hopper', $renamed->name);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'Grace Hopper']);
    }

    public function test_it_finds_a_user_by_the_sha1_digest_of_their_email(): void {
        $service = new UserService();
        $created = $service->create($this->data(['email' => 'ada@example.com']));

        $found = $service->findByEmailDigest(sha1('ada@example.com'));

        $this->assertTrue($created->is($found));
    }

    public function test_it_returns_null_for_a_digest_matching_no_user(): void {
        $this->assertNull((new UserService())->findByEmailDigest(sha1('ghost@example.com')));
    }

    public function test_a_duplicate_email_violates_the_unique_constraint(): void {
        $service = new UserService();
        $service->create($this->data());

        $this->expectException(UniqueConstraintViolationException::class);
        $service->create($this->data());
    }
}
