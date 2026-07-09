<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * The single authoritative role definition for the backend (FR-012): the closed,
 * strictly-ordered set guest < member < admin < superuser, plus the "outranks"
 * comparison and the assignable-subset guard. Guest is the implicit role of an
 * unauthenticated actor and is never stored on a row (research D2).
 */
enum Role: string {
    case Guest = 'guest';
    case Member = 'member';
    case Admin = 'admin';
    case Superuser = 'superuser';

    /** Privilege rank; higher means more privileged (Guest 0 → Superuser 3). */
    public function rank(): int {
        return match ($this) {
            self::Guest => 0,
            self::Member => 1,
            self::Admin => 2,
            self::Superuser => 3,
        };
    }

    /** Strict order: true iff this role is more privileged than $other; equal ⇒ false. */
    public function outranks(self $other): bool {
        return $this->rank() > $other->rank();
    }

    /**
     * Values a real account may hold — excludes Guest (implicit-only). Drives
     * validation and the first-superuser bootstrap.
     *
     * @return list<self>
     */
    public static function assignable(): array {
        return [self::Member, self::Admin, self::Superuser];
    }

    /** Parse an assignable value, or null for guest / anything out-of-set (FR-005 guard). */
    public static function tryFromAssignable(string $value): ?self {
        $role = self::tryFrom($value);

        return $role !== null && in_array($role, self::assignable(), true) ? $role : null;
    }
}
