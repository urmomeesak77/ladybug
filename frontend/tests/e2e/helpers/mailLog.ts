import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads the e2e backend's log-mailer output (research D7): with MAIL_MAILER=log the
// whole MIME message — including the quoted-printable HTML body carrying the
// verification link — lands in backend/storage/logs/laravel.log, which the e2e stack
// bind-mounts from the host. In-house on purpose: a mail-catcher service would be a
// new infra dependency (Principle I).
export class MailLog {
  private static readonly LOG_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    // From tests/e2e/helpers/ up to the repo root is four levels
    // (helpers → e2e → tests → frontend → root).
    '../../../../backend/storage/logs/laravel.log',
  );

  // The newest /verify-email/... link in the log, optionally scoped to the most
  // recent message addressed to `recipient`. Null when no message has arrived.
  static latestVerificationLink(recipient?: string): string | null {
    let content: string;
    try {
      content = readFileSync(MailLog.LOG_PATH, 'utf8');
    } catch {
      return null;
    }
    const decoded = MailLog.decodeQuotedPrintable(content);
    const scope = recipient === undefined ? decoded : MailLog.lastMessageTo(decoded, recipient);
    if (scope === null) {
      return null;
    }
    // The body HTML-escapes the query separator, so &amp; must fold back to &.
    const links = scope.replace(/&amp;/g, '&').match(/http:\/\/[^\s"'<>)]+\/verify-email\/[^\s"'<>)]+/g);
    return links === null ? null : links[links.length - 1];
  }

  // MIME quoted-printable, deliberately minimal: unfold the soft line breaks that
  // split long URLs and decode =3D (the '=' every query parameter needs). A full
  // =XX decode would corrupt UNencoded bodies — the log transport writes the URL
  // with literal '=', so `expires=17...`/`signature=22...` would have their first
  // two hex-looking digits eaten (seen live: e2e links 403'd). '3D' can never open
  // a real expires (digits) or signature (lowercase hex) value, so =3D stays safe.
  static decodeQuotedPrintable(text: string): string {
    return text.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  }

  // The slice of the log from the LAST message addressed to `recipient` up to the
  // next message's To: header — resends must resolve to the newest link.
  private static lastMessageTo(log: string, recipient: string): string | null {
    const marker = `To: ${recipient}`;
    const start = log.lastIndexOf(marker);
    if (start === -1) {
      return null;
    }
    const nextMessage = log.indexOf('To: ', start + marker.length);
    return nextMessage === -1 ? log.slice(start) : log.slice(start, nextMessage);
  }
}
