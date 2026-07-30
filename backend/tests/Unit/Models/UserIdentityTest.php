<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\User;
use App\Models\UserIdentity;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class UserIdentityTest extends TestCase {
    use RefreshDatabase;

    public function test_nothing_is_mass_assignable(): void {
        $this->assertSame([], (new UserIdentity())->getFillable());
    }

    public function test_filling_the_provider_subject_is_refused_outright(): void {
        // provider_user_id is the sole key to an account, so anything that could
        // reach it through fill() from a request body would be an account-takeover
        // primitive — the same reason `role` and `rating` are kept out of User's
        // $fillable (data-model §1). An EMPTY $fillable leaves the model totally
        // guarded, which refuses louder than User's silent discard: it throws.
        $identity = new UserIdentity();

        $this->expectException(MassAssignmentException::class);
        $identity->fill(['provider_user_id' => '1234567890']);
    }

    public function test_a_refused_fill_assigns_nothing(): void {
        $identity = new UserIdentity();

        try {
            $identity->fill(['provider' => 'google', 'provider_user_id' => '1234567890', 'user_id' => 1]);
        }
        catch (MassAssignmentException) {
            // The refusal itself is asserted above; what matters here is that the
            // model is left untouched, with no key having slipped through first.
        }

        $this->assertNull($identity->provider);
        $this->assertNull($identity->provider_user_id);
        $this->assertNull($identity->user_id);
    }

    public function test_the_provider_subject_is_hidden(): void {
        $this->assertContains('provider_user_id', (new UserIdentity())->getHidden());
    }

    public function test_the_provider_subject_is_absent_from_the_serialized_model(): void {
        // Belt-and-braces for FR-022/INV-8: no resource serializes this model at all,
        // but if one ever did, the subject must not travel with it.
        $identity = UserIdentity::factory()->create(['provider_user_id' => '1234567890']);

        $this->assertArrayNotHasKey('provider_user_id', $identity->toArray());
    }

    public function test_user_resolves_the_owning_account(): void {
        $user = User::factory()->create();
        $identity = new UserIdentity();
        $identity->user_id = $user->id;
        $identity->provider = 'google';
        $identity->provider_user_id = '1234567890';
        $identity->save();

        $this->assertTrue($identity->fresh()->user->is($user));
    }

    public function test_the_factory_produces_a_google_link_on_its_own_account(): void {
        $identity = UserIdentity::factory()->create();

        $this->assertSame('google', $identity->provider);
        $this->assertNotSame('', $identity->provider_user_id);
        $this->assertInstanceOf(User::class, $identity->user);
    }
}
