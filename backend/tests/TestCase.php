<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase {
    /**
     * Refuse to run against anything but the SQLite :memory: database.
     *
     * RefreshDatabase runs migrate:fresh, which would wipe whatever DB the
     * resolved config points at. phpunit.xml forces sqlite :memory:, but a real
     * DB_* env var in the process wins over that force (this is how a docker
     * compose DB_* leak once wiped the live dev DB, and how CI silently ran on
     * MySQL). refreshApplication() boots the app config but runs *before*
     * setUpTraits() applies RefreshDatabase, so this is the last safe moment to
     * abort before any migration or write touches a real database.
     */
    protected function refreshApplication(): void {
        parent::refreshApplication();
        $this->assertIsolatedTestDatabase();
    }

    private function assertIsolatedTestDatabase(): void {
        $connection = config('database.default');
        $database = config("database.connections.{$connection}.database");
        if ($connection === 'sqlite' && $database === ':memory:') {
            return;
        }

        throw new RuntimeException(sprintf(
            'Refusing to run tests: expected the sqlite :memory: connection but got [%s/%s]. '
            . 'A real DB_* env var is leaking into the test process — tests must never touch a real database.',
            (string) $connection,
            (string) $database,
        ));
    }
}
