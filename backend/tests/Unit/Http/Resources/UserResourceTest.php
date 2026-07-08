<?php

declare(strict_types=1);

namespace Tests\Unit\Http\Resources;

use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class UserResourceTest extends TestCase {
    use RefreshDatabase;

    public function test_it_exposes_only_the_safe_public_fields_in_order(): void {
        $user = User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
        ]);

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertSame(
            ['id', 'name', 'email', 'email_verified_at', 'created_at', 'updated_at'],
            array_keys($data),
        );
        $this->assertSame($user->id, $data['id']);
        $this->assertSame('Ada Lovelace', $data['name']);
        $this->assertSame('ada@example.com', $data['email']);
    }

    public function test_it_never_exposes_the_password_or_remember_token(): void {
        $user = User::factory()->create();

        $data = (new UserResource($user))->toArray(Request::create('/'));

        $this->assertArrayNotHasKey('password', $data);
        $this->assertArrayNotHasKey('remember_token', $data);
    }
}
