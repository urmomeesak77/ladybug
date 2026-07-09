<?php

declare(strict_types=1);

namespace Tests\Unit\Enums;

use App\Enums\Role;
use PHPUnit\Framework\TestCase;

/**
 * The authoritative role vocabulary (FR-012): its ranks, the exhaustive 16-pair
 * "outranks" matrix (SC-004), and the assignable-subset guard. Pure enum logic —
 * no database, so it extends the plain PHPUnit TestCase.
 */
final class RoleTest extends TestCase {
    public function test_rank_is_zero_through_three_in_ascending_privilege(): void {
        $this->assertSame(0, Role::Guest->rank());
        $this->assertSame(1, Role::Member->rank());
        $this->assertSame(2, Role::Admin->rank());
        $this->assertSame(3, Role::Superuser->rank());
    }

    /**
     * SC-004: every ordered pair. A role outranks another iff its rank is strictly
     * higher; equal ranks return false (a role does not outrank itself).
     */
    public function test_outranks_matches_the_full_sixteen_pair_matrix(): void {
        $cases = Role::cases();
        foreach ($cases as $a) {
            foreach ($cases as $b) {
                $expected = $a->rank() > $b->rank();
                $this->assertSame(
                    $expected,
                    $a->outranks($b),
                    "{$a->value} outranks {$b->value}",
                );
            }
        }
    }

    public function test_a_role_never_outranks_itself(): void {
        foreach (Role::cases() as $role) {
            $this->assertFalse($role->outranks($role), "{$role->value} must not outrank itself");
        }
    }

    public function test_assignable_is_exactly_member_admin_superuser(): void {
        $this->assertSame(
            [Role::Member, Role::Admin, Role::Superuser],
            Role::assignable(),
        );
        $this->assertNotContains(Role::Guest, Role::assignable());
    }

    public function test_try_from_assignable_accepts_assignable_values(): void {
        $this->assertSame(Role::Member, Role::tryFromAssignable('member'));
        $this->assertSame(Role::Admin, Role::tryFromAssignable('admin'));
        $this->assertSame(Role::Superuser, Role::tryFromAssignable('superuser'));
    }

    public function test_try_from_assignable_rejects_guest_and_out_of_set_values(): void {
        $this->assertNull(Role::tryFromAssignable('guest'));
        $this->assertNull(Role::tryFromAssignable('nope'));
        $this->assertNull(Role::tryFromAssignable(''));
    }
}
