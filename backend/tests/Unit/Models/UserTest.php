<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\User;
use Tests\TestCase;

final class UserTest extends TestCase
{
    public function test_mass_assignable_attributes(): void
    {
        $user = new User();

        $this->assertSame(['name', 'email', 'password'], $user->getFillable());
    }

    public function test_sensitive_attributes_are_hidden(): void
    {
        $hidden = (new User())->getHidden();

        $this->assertContains('password', $hidden);
        $this->assertContains('remember_token', $hidden);
    }

    public function test_casts_secure_sensitive_attributes(): void
    {
        $casts = (new User())->getCasts();

        $this->assertSame('hashed', $casts['password']);
        $this->assertSame('datetime', $casts['email_verified_at']);
    }
}
