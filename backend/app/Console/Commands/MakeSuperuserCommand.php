<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Operator-only bootstrap of the first superuser (FR-009): promotes the account
 * with the given email to superuser without needing a pre-existing privileged
 * account. It is a console command, not an HTTP route, so it is unreachable as an
 * ordinary in-app request. Keys off the email — never a DB id (no ids as handles).
 */
final class MakeSuperuserCommand extends Command {
    protected $signature = 'user:make-superuser {email : The email of the account to promote}';

    protected $description = 'Promote the account with the given email to the superuser role';

    public function handle(): int {
        $email = (string) $this->argument('email');
        $user = User::where('email', $email)->first();

        if ($user === null) {
            $this->error("No account found for email: {$email}");

            return self::FAILURE;
        }

        if ($user->role === Role::Superuser) {
            $this->info("{$email} is already a superuser.");

            return self::SUCCESS;
        }

        $user->role = Role::Superuser;
        $user->save();
        $this->info("Promoted {$email} to superuser.");

        return self::SUCCESS;
    }
}
