<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\RememberMe;
use Illuminate\Support\Facades\Cookie;
use Tests\TestCase;

final class RememberMeTest extends TestCase {
    public function test_queue_queues_the_flag_cookie_with_the_configured_name_and_value(): void {
        RememberMe::queue();

        $this->assertTrue(Cookie::hasQueued(config('remember.cookie')));
        $this->assertSame('1', Cookie::queued(config('remember.cookie'))->getValue());
    }

    public function test_queue_uses_the_configured_lifetime(): void {
        RememberMe::queue();

        $cookie = Cookie::queued(config('remember.cookie'));

        // A fresh flag cookie must expire well in the future, not immediately —
        // the whole point of "remember me" is that it outlives the browser session.
        $this->assertGreaterThan(time(), $cookie->getExpiresTime());
    }

    public function test_forget_queues_a_cookie_that_clears_the_flag(): void {
        RememberMe::forget();

        $this->assertTrue(Cookie::hasQueued(config('remember.cookie')));

        $cookie = Cookie::queued(config('remember.cookie'));
        $this->assertNull($cookie->getValue());
        $this->assertLessThan(time(), $cookie->getExpiresTime());
    }
}
