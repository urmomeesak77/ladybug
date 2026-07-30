<?php

declare(strict_types=1);

namespace Tests\Unit\Exceptions;

use App\Exceptions\OAuthFailure;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class OAuthFailureTest extends TestCase {
    /**
     * The seven codes of research D10, closed set. This list is asserted rather than
     * derived from the class so that adding an eighth code is a deliberate edit here
     * too — the frontend's GoogleAuth.errorMessage() maps exactly these seven.
     *
     * @return array<string, array{string}>
     */
    public static function codes(): array {
        return [
            'cancelled' => [OAuthFailure::CANCELLED],
            'state' => [OAuthFailure::STATE],
            'unverified email' => [OAuthFailure::UNVERIFIED_EMAIL],
            'already linked' => [OAuthFailure::ALREADY_LINKED],
            'disabled' => [OAuthFailure::DISABLED],
            'rate limited' => [OAuthFailure::RATE_LIMITED],
            'provider' => [OAuthFailure::PROVIDER],
        ];
    }

    #[DataProvider('codes')]
    public function test_the_failure_carries_its_code_verbatim(string $code): void {
        $failure = new OAuthFailure($code);

        $this->assertSame($code, $failure->failureCode);
    }

    public function test_the_seven_codes_are_the_documented_values(): void {
        $this->assertSame(
            ['cancelled', 'state', 'unverified_email', 'already_linked', 'disabled', 'rate_limited', 'provider'],
            array_map(fn (array $row): string => $row[0], array_values(self::codes())),
        );
    }

    public function test_the_message_names_the_code_for_the_log(): void {
        $failure = new OAuthFailure(OAuthFailure::ALREADY_LINKED);

        $this->assertSame('Google sign-in refused: already_linked', $failure->getMessage());
    }

    public function test_the_failure_is_catchable_as_a_runtime_exception(): void {
        // The controller catches OAuthFailure specifically; this only pins the parent
        // so an unhandled one still lands in Laravel's ordinary exception path.
        $this->assertInstanceOf(RuntimeException::class, new OAuthFailure(OAuthFailure::STATE));
    }
}
