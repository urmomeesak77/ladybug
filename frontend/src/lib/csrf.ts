// Reads Laravel's URL-encoded XSRF-TOKEN cookie so Sanctum's CSRF guard accepts unsafe
// requests. Shared by every authenticated client (auth + upload) so the read lives once.
// Guarded so the non-DOM test environment is safe.
export class Csrf {
  static token(): string {
    const cookies = typeof document !== 'undefined' ? document.cookie : '';
    const match = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}
