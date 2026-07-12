import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Promotes an e2e-registered account to superuser (admin+) by running the operator command
// INSIDE the isolated e2e backend container. `user:make-superuser` keys off the email (never
// a DB id), and superuser outranks admin, so a promoted account satisfies the role:admin gate
// on both the API and the SPA route. This reaches into the same disposable `ladybug-e2e`
// Compose project that scripts/e2e.ps1 stands up — never the live dev trashdb. In-house on
// purpose: elevating via the shipped console command needs no extra e2e infrastructure
// (Principle I), and there is no HTTP path to grant a role by design.
export class AdminSetup {
  private static readonly COMPOSE_FILE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../docker-compose.e2e.yml',
  );

  static promoteToSuperuser(email: string): void {
    execFileSync(
      'docker',
      [
        'compose',
        '-p',
        'ladybug-e2e',
        '-f',
        AdminSetup.COMPOSE_FILE,
        'exec',
        '-T',
        'backend-e2e',
        'php',
        'artisan',
        'user:make-superuser',
        email,
      ],
      { stdio: 'pipe' },
    );
  }
}
