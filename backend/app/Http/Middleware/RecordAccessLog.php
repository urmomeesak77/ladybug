<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\AccessLogService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * One durable entry per HTTP request the application handled (FR-001, 023).
 *
 * Prepended to the global stack, so it is the outermost frame — ahead of TrustProxies,
 * HandleCors, PreventRequestsDuringMaintenance and ValidatePostSize. That placement is what
 * makes FR-001 true for the awkward cases: a request a guard rejected still passes back
 * through here, and a thrown Throwable has already been rendered into a real response by
 * Illuminate\Routing\Pipeline while unwinding, so the after-phase sees the status the
 * visitor actually received rather than an exception (research D1).
 *
 * Recording happens in the after-phase, which runs before Response::send() — so the entry is
 * durably stored before the response is delivered (FR-001a) with no queue and no terminable
 * hook, since terminable middleware runs after the response is flushed.
 *
 * The response is returned exactly as received (FR-026), and a failed write cannot reach the
 * visitor: AccessLogService contains it (FR-025).
 */
final class RecordAccessLog {
    public function __construct(private readonly AccessLogService $log) {
    }

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response {
        // Never LARAVEL_START: it is a process-global constant, so under the PHPUnit kernel
        // — where many requests share one process — every request after the first would
        // report a duration measured from process start (research D3). This entry timestamp
        // is also the arrival time the row is stored under.
        $startedAt = microtime(true);

        $response = $next($request);

        $this->log->record($request, $response, $startedAt, $this->actor($request));

        return $response;
    }

    /**
     * The account the request arrived as, stashed by CaptureAccessLogActor at the first
     * point the session was live. Absent for anonymous traffic, and for a request rejected
     * before the group ran at all — the application never established who the visitor was,
     * and no account is the correct conservative answer (research D2).
     */
    private function actor(Request $request): ?int {
        $userId = $request->attributes->get(CaptureAccessLogActor::ATTRIBUTE);

        return is_numeric($userId) ? (int) $userId : null;
    }
}
