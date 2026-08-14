<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\AccessLog;
use App\Support\AccessLogRedactor;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * The only writer of the access log (023).
 *
 * It runs on the visitor's critical path, after the response exists but before it is
 * delivered (FR-001a), so it is exactly one INSERT: no extra round trip, no users lookup,
 * no second connection handshake (SC-002). And it contains its own failure — a broken or
 * unreachable store degrades to "answered but not recorded" and is surfaced through the
 * application's existing error reporting, never to the visitor (FR-025, research D11).
 */
class AccessLogService {
    /** Rows deleted per pruning pass — small enough that each commit is unnoticed by traffic. */
    private const PRUNE_CHUNK = 1000;

    /**
     * Record one request and the response it produced.
     *
     * $startedAt is the microtime captured in the recorder's before-phase, and is the
     * source of BOTH stored times: created_at is the moment the request arrived (not the
     * moment the row was written), and duration_us is the elapsed time to this point.
     */
    public function record(Request $request, Response $response, float $startedAt, ?int $userId): void {
        try {
            $this->build($request, $response, $startedAt, $userId)->save();
        }
        catch (Throwable $e) {
            // Catching Throwable, not Exception: a missing table arrives as a QueryException
            // but a misconfigured connection can surface as an Error, and neither may reach
            // a visitor who has already been answered.
            report($e);
        }
    }

    /**
     * Delete every entry older than $days and return how many went.
     *
     * Chunked rather than one statement (FR-027): a single DELETE over a month of a busy
     * history holds row locks and grows the undo log for the whole of its run, while
     * 1000-row passes commit continuously and leave gaps for the inserts the recorder is
     * still making. It is also what makes an interrupted run harmless (FR-027c) — a killed
     * process has simply done less, with no half-state to repair and no cursor to resume
     * from — and what makes two simultaneous runs safe: each pass just finds fewer rows.
     */
    public function prune(int $days): int {
        // The same guard config/access_log.php puts on ACCESS_LOG_RETENTION_DAYS, repeated
        // because --days= arrives here without passing through the config file: a window of
        // 0 would put the cutoff at now() and delete the entire history.
        $cutoff = Carbon::now()->subDays(max(1, $days));
        $deleted = 0;
        do {
            // Computed once, above: recomputing it per pass would let a long run chase the
            // clock forward into entries that were inside the window when it started.
            $pass = AccessLog::query()->where('created_at', '<', $cutoff)->limit(self::PRUNE_CHUNK)->delete();
            $deleted += $pass;
        }
        while ($pass > 0);

        return $deleted;
    }

    /**
     * Assign every column explicitly — the model has no $fillable, because a machine-built
     * row has no reason to accept a request-shaped array (research D9).
     */
    private function build(Request $request, Response $response, float $startedAt, ?int $userId): AccessLog {
        $entry = new AccessLog();
        $entry->created_at = Carbon::createFromTimestamp($startedAt, 'UTC');
        // The peer address, straight off the connection. Never $request->ip(), which
        // trustProxies(at: '*') makes forgeable — the whole point of FR-002a (research D4).
        $entry->remote_addr = (string) $request->server->get('REMOTE_ADDR');
        // The claim, kept verbatim as evidence and never consulted for a decision.
        $entry->forwarded_for = (string) AccessLogRedactor::column(
            (string) $request->headers->get('X-Forwarded-For', ''),
            AccessLogRedactor::FORWARDED_FOR_WIDTH,
        );
        $entry->method = $request->getMethod();
        $entry->path = (string) AccessLogRedactor::column($request->path(), AccessLogRedactor::PATH_WIDTH);
        $entry->status = $response->getStatusCode();
        $entry->duration_us = (int) round((microtime(true) - $startedAt) * 1_000_000);
        $entry->response_bytes = $this->responseBytes($response);
        $entry->user_id = $userId;
        $entry->user_agent = AccessLogRedactor::column(
            $request->headers->get('User-Agent'),
            AccessLogRedactor::USER_AGENT_WIDTH,
        );
        $entry->referer = AccessLogRedactor::column(
            $request->headers->get('Referer'),
            AccessLogRedactor::REFERER_WIDTH,
        );
        $entry->query = AccessLogRedactor::map($request->query());
        $entry->input = AccessLogRedactor::map($this->input($request));
        $entry->cookies = AccessLogRedactor::map($request->cookies->all());
        $entry->files = AccessLogRedactor::files($request);
        $entry->body = AccessLogRedactor::text($this->rawBody($request));

        return $entry;
    }

    /**
     * The submitted parameters, parsed — form fields or the JSON document.
     *
     * @return array<mixed, mixed>
     */
    private function input(Request $request): array {
        return $request->isJson() ? $request->json()->all() : $request->post();
    }

    /**
     * The raw body, and ONLY for a content type nothing else parsed (FR-005a, research D5).
     *
     * A raw body stored beside the parsed map would defeat the whole of US2: for
     * POST /api/login it literally contains password=hunter2, and name-based redaction
     * cannot reach inside an opaque string. Where the body IS parseable it is already fully
     * represented by the redacted map; where it is not, this is the only record there is.
     * For multipart the raw body is the uploaded file, which FR-017 forbids outright.
     */
    private function rawBody(Request $request): ?string {
        $type = strtolower((string) $request->headers->get('Content-Type', ''));
        if ($request->isJson()
            || str_contains($type, 'application/x-www-form-urlencoded')
            || str_contains($type, 'multipart/form-data')) {
            return null;
        }

        $content = $request->getContent();

        return is_string($content) ? $content : null;
    }

    /**
     * The declared Content-Length, else the measured content, else nothing.
     *
     * A StreamedResponse or BinaryFileResponse has no content string, and its callback is
     * never invoked to find out — NULL means "not measurable", which is honest where 0
     * would be a lie (FR-011).
     */
    private function responseBytes(Response $response): ?int {
        $declared = $response->headers->get('Content-Length');
        if (is_numeric($declared)) {
            return (int) $declared;
        }

        $content = $response->getContent();

        return is_string($content) ? strlen($content) : null;
    }
}
