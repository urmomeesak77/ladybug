import { Api } from './api';

// Reads Laravel's URL-encoded XSRF-TOKEN cookie so Sanctum's CSRF guard accepts unsafe
// requests. Shared by every authenticated client (auth + upload + moderation) so the
// read lives once. Guarded so the non-DOM test environment is safe.
export class Csrf {
  static token(): string {
    const cookies = typeof document !== 'undefined' ? document.cookie : '';
    const match = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  // The Sanctum SPA priming step: when no XSRF cookie exists yet (first unsafe request
  // of a fresh session, or a boot where GET /api/user failed), ask /sanctum/csrf-cookie
  // to set it, then re-read. Callers get a usable token without depending on the boot
  // probe having set one as a side effect (review 2026-07-10).
  static async ensure(): Promise<string> {
    const existing = Csrf.token();
    if (existing !== '') {
      return existing;
    }
    await fetch(`${Api.base()}/sanctum/csrf-cookie`, { credentials: 'include' });
    return Csrf.token();
  }
}
