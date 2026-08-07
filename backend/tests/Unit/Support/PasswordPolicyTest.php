<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\PasswordPolicy;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Tests\TestCase;

/**
 * The one server-side password rule set (FR-013, FR-029, research D9). Registration,
 * recovery reset, and the account-page change all validate through this, so a drift
 * between them is impossible by construction rather than by review.
 *
 * The `min(8)->mixedCase()->numbers()` configuration is asserted through the validator
 * rather than by reflecting on the Password object's protected state: a rule that is
 * built correctly but rejects nothing would pass a structural check and fail a user.
 */
final class PasswordPolicyTest extends TestCase {
    public function test_rules_state_the_policy_as_required_string_confirmed_plus_a_password_rule(): void {
        $rules = PasswordPolicy::rules();

        $this->assertContains('required', $rules);
        $this->assertContains('string', $rules);
        $this->assertContains('confirmed', $rules);
        $this->assertCount(1, array_filter($rules, static fn ($rule) => $rule instanceof Password));
    }

    public function test_a_password_meeting_every_clause_passes(): void {
        $this->assertTrue($this->validate('Password1', 'Password1')->passes());
    }

    public function test_a_missing_password_is_rejected(): void {
        $errors = $this->validate('', '')->errors();

        $this->assertTrue($errors->has('password'));
    }

    public function test_a_password_under_eight_characters_is_rejected(): void {
        $errors = $this->validate('Pass1', 'Pass1')->errors();

        $this->assertContains('The password field must be at least 8 characters.', $errors->get('password'));
    }

    public function test_a_lowercase_only_password_is_rejected(): void {
        $errors = $this->validate('password1', 'password1')->errors();

        $this->assertContains(
            'The password field must contain at least one uppercase and one lowercase letter.',
            $errors->get('password'),
        );
    }

    public function test_an_uppercase_only_password_is_rejected(): void {
        $errors = $this->validate('PASSWORD1', 'PASSWORD1')->errors();

        $this->assertContains(
            'The password field must contain at least one uppercase and one lowercase letter.',
            $errors->get('password'),
        );
    }

    public function test_a_password_without_a_digit_is_rejected(): void {
        $errors = $this->validate('Passwords', 'Passwords')->errors();

        $this->assertContains('The password field must contain at least one number.', $errors->get('password'));
    }

    public function test_a_mismatched_confirmation_is_rejected(): void {
        $errors = $this->validate('Password1', 'Password2')->errors();

        $this->assertContains('The password field confirmation does not match.', $errors->get('password'));
    }

    /**
     * Validate a candidate exactly as a form request would: the policy under the
     * `password` key, with `password_confirmation` alongside it for the `confirmed` clause.
     */
    private function validate(string $password, string $confirmation): \Illuminate\Validation\Validator {
        return Validator::make(
            ['password' => $password, 'password_confirmation' => $confirmation],
            ['password' => PasswordPolicy::rules()],
        );
    }
}
