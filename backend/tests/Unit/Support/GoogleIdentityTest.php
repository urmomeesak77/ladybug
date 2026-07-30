<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Exceptions\OAuthFailure;
use App\Support\GoogleIdentity;
use Tests\TestCase;

final class GoogleIdentityTest extends TestCase {
    public function test_the_claims_become_the_four_fields(): void {
        $identity = GoogleIdentity::fromClaims([
            'sub' => '1234567890',
            'email' => 'ada@example.com',
            'email_verified' => true,
            'name' => 'Ada Lovelace',
        ]);

        $this->assertSame('1234567890', $identity->sub);
        $this->assertSame('ada@example.com', $identity->email);
        $this->assertTrue($identity->isEmailVerified);
        $this->assertSame('Ada Lovelace', $identity->name);
    }

    public function test_an_absent_name_claim_is_null(): void {
        $this->assertNull($this->identity(['name' => null])->name);
    }

    public function test_an_empty_subject_is_refused(): void {
        $this->assertRefused(['sub' => '']);
    }

    public function test_an_oversized_subject_is_refused(): void {
        // FR-024: everything from the provider is bounded before storage. Google's
        // `sub` is 21 digits today; 256 characters is not a `sub`, it is an attack
        // on the column.
        $this->assertRefused(['sub' => str_repeat('9', 256)]);
    }

    public function test_a_subject_at_the_limit_is_accepted(): void {
        $this->assertSame(255, mb_strlen($this->identity(['sub' => str_repeat('9', 255)])->sub));
    }

    public function test_a_malformed_address_is_refused(): void {
        $this->assertRefused(['email' => 'not-an-email']);
    }

    public function test_an_empty_address_is_refused(): void {
        $this->assertRefused(['email' => '']);
    }

    public function test_an_oversized_address_is_refused(): void {
        $this->assertRefused(['email' => str_repeat('a', 300) . '@example.com']);
    }

    public function test_the_verified_claim_is_accepted_only_in_its_three_true_forms(): void {
        foreach ([true, 'true', 1] as $claim) {
            $this->assertTrue(
                $this->identity(['email_verified' => $claim])->isEmailVerified,
                'expected ' . var_export($claim, true) . ' to read as verified',
            );
        }
    }

    public function test_every_other_verified_claim_is_false(): void {
        // FR-024/research D13: anything outside those three forms is false — including
        // a *string* "false", which is truthy in PHP, and the integer 0. This flag is
        // the load-bearing guard under the US3 auto-link, so a loose cast here would
        // let an unconfirmed address claim an existing account.
        foreach ([false, 'false', 0, null, '', 'yes please', [], '1'] as $claim) {
            $this->assertFalse(
                $this->identity(['email_verified' => $claim])->isEmailVerified,
                'expected ' . var_export($claim, true) . ' to read as unverified',
            );
        }
    }

    public function test_an_absent_verified_claim_is_false(): void {
        $identity = GoogleIdentity::fromClaims(['sub' => '1234567890', 'email' => 'ada@example.com']);

        $this->assertFalse($identity->isEmailVerified);
    }

    public function test_the_display_name_is_the_name_claim(): void {
        $this->assertSame('Ada Lovelace', $this->identity(['name' => 'Ada Lovelace'])->displayName());
    }

    public function test_a_name_of_zero_survives(): void {
        // '0' is falsy in PHP but is a perfectly good name claim. The emptiness test
        // has to be a strict comparison, not a truthiness check.
        $this->assertSame('0', $this->identity(['name' => '0'])->displayName());
    }

    public function test_the_display_name_is_trimmed(): void {
        $this->assertSame('Ada Lovelace', $this->identity(['name' => "  Ada Lovelace \n "])->displayName());
    }

    public function test_the_display_name_strips_control_characters(): void {
        $this->assertSame('AdaLovelace', $this->identity(['name' => "Ada\x00Love\nlace"])->displayName());
    }

    public function test_the_display_name_is_capped_at_the_column_width(): void {
        $name = $this->identity(['name' => str_repeat('x', 300)])->displayName();

        $this->assertSame(255, mb_strlen($name));
    }

    public function test_the_display_name_keeps_multibyte_characters_whole(): void {
        // The cap counts characters, not bytes, so a cut never lands mid-codepoint.
        $name = $this->identity(['name' => str_repeat('ä', 300)])->displayName();

        $this->assertSame(255, mb_strlen($name));
        $this->assertSame(str_repeat('ä', 255), $name);
    }

    public function test_the_display_name_is_stored_raw_and_not_escaped(): void {
        // Research D13: the name is escaped on OUTPUT (React text children), exactly as
        // feature 015 treats comment bodies. Escaping at write time would double-escape
        // and corrupt a legitimate name.
        $raw = "Ada & <b>Bob</b> O'Hara";

        $this->assertSame($raw, $this->identity(['name' => $raw])->displayName());
    }

    public function test_the_display_name_falls_back_to_the_address_local_part(): void {
        foreach ([null, '', '   ', "\x00\x01"] as $name) {
            $identity = $this->identity(['name' => $name, 'email' => 'ada.lovelace@example.com']);

            $this->assertSame('ada.lovelace', $identity->displayName());
        }
    }

    public function test_the_display_name_is_never_empty(): void {
        // FR-016 wants a name for every account, whatever the provider sent. The method
        // is total by construction rather than by argument (research D13).
        $names = [null, '', ' ', "\x00", "\n\t\r", "\u{200B}", str_repeat("\x01", 300), '0'];

        foreach ($names as $name) {
            $this->assertNotSame('', $this->identity(['name' => $name])->displayName());
        }
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function identity(array $overrides = []): GoogleIdentity {
        return GoogleIdentity::fromClaims(array_merge([
            'sub' => '1234567890',
            'email' => 'ada@example.com',
            'email_verified' => true,
            'name' => 'Ada Lovelace',
        ], $overrides));
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function assertRefused(array $overrides): void {
        try {
            $this->identity($overrides);
        }
        catch (OAuthFailure $failure) {
            // A bounds failure is a `provider` refusal: the visitor did nothing wrong
            // and there is nothing for them to correct (data-model §5, research D10).
            $this->assertSame(OAuthFailure::PROVIDER, $failure->failureCode);

            return;
        }

        $this->fail('the claims should have been refused: ' . json_encode($overrides));
    }
}
