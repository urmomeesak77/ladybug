<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;

/**
 * Shapes everything the access log records before it reaches the model: uploaded files
 * flattened to a description, invalid byte sequences coerced, and every value capped.
 *
 * Order is fixed and load-bearing — redact (US2), then coerce, then truncate. Truncating
 * first would leave a 64 KB partial secret in the row; cutting bytes before coercion can
 * split a multi-byte character and produce the invalid sequence FR-019 exists to prevent.
 */
final class AccessLogRedactor {
    /**
     * The four string columns whose contents come from the visitor and can exceed the
     * schema. config/database.php sets 'strict' => true, so one byte past the varchar
     * rejects the whole INSERT and the entry is lost to a QueryException record()
     * swallows — a truncation rule that destroys what it was shaping. Mirrors the widths
     * declared in 2026_08_14_000000_create_access_logs_table.php.
     */
    public const PATH_WIDTH = 2048;
    public const FORWARDED_FOR_WIDTH = 255;
    public const USER_AGENT_WIDTH = 1024;
    public const REFERER_WIDTH = 2048;

    /**
     * U+0020, U+2026, `[truncated]` — 15 bytes in UTF-8. Held as one constant, never
     * assembled from parts, so no call site can spell it differently and every length rule
     * below is expressed against its strlen rather than against the number written out again.
     */
    private const MARKER = ' …[truncated]';

    /**
     * Shape a recorded parameter map — query, input or cookies — at every nesting depth.
     *
     * Returns null for an empty map: an absent cookie header and an empty cookie jar are
     * the same thing to an operator, and NULL keeps the row smaller (data-model.md).
     *
     * @param  array<mixed, mixed>  $values
     * @return array<mixed, mixed>|null
     */
    public static function map(array $values): ?array {
        if ($values === []) {
            return null;
        }

        /** @var array<mixed, mixed> $shaped */
        $shaped = self::shape($values);

        return $shaped;
    }

    /**
     * Shape a single free-standing string — the raw body of an unparseable request.
     * An empty body is nothing to record, not an empty string.
     */
    public static function text(?string $value): ?string {
        if ($value === null || $value === '') {
            return null;
        }

        return self::truncate(self::coerce($value));
    }

    /**
     * Cap a value at its column's width, marker included.
     *
     * The opposite budgeting to the per-value limit, deliberately: here the marker is cut
     * OUT of the width rather than appended past it, so the stored string lands at the
     * column width instead of 15 bytes beyond it (data-model.md rule 4).
     */
    public static function column(?string $value, int $width): ?string {
        if ($value === null) {
            return null;
        }

        $value = self::coerce($value);
        if (strlen($value) <= $width) {
            return $value;
        }

        return mb_strcut($value, 0, $width - strlen(self::MARKER), 'UTF-8') . self::MARKER;
    }

    /**
     * Describe each uploaded file without ever reading its bytes (FR-017).
     *
     * The mime is the CLIENT-declared type: resolving the real one means reading the file,
     * which is the single thing this must not do. It is an untrusted claim and is recorded
     * as one, exactly like forwarded_for.
     *
     * @return array<int, array{field: string, name: string|null, mime: string, size: int}>|null
     */
    public static function files(Request $request): ?array {
        $described = [];
        // Arr::dot recurses into arrays but not into objects, so `docs[]` becomes
        // docs.0 / docs.1 and each upload keeps the field it arrived under.
        foreach (Arr::dot($request->allFiles()) as $field => $file) {
            if (! $file instanceof UploadedFile) {
                continue;
            }

            $described[] = [
                'field' => (string) $field,
                // Visitor-supplied, so it is shaped like any other value. It is never used
                // as a path — nothing in this feature writes a file.
                'name' => self::text($file->getClientOriginalName()),
                'mime' => $file->getClientMimeType(),
                'size' => (int) $file->getSize(),
            ];
        }

        return $described === [] ? null : $described;
    }

    /**
     * Coerce and cap one value, recursing into arrays. Non-string scalars are preserved
     * as they are — an int, a float, a bool and a null are already safe to encode and
     * carry no length worth capping.
     */
    private static function shape(mixed $value): mixed {
        if (is_array($value)) {
            $shaped = [];
            foreach ($value as $key => $item) {
                $shaped[$key] = self::shape($item);
            }

            return $shaped;
        }

        if (is_string($value)) {
            return self::truncate(self::coerce($value));
        }

        return $value;
    }

    /**
     * Cut at the configured per-value limit on a character boundary and mark the cut.
     *
     * The marker sits OUTSIDE the budget (contracts/redaction.md), so a marked value
     * occupies up to value_limit + 15 bytes. That is the only reading under which SC-005a's
     * two clauses both hold, and it is why `body` is longtext rather than TEXT.
     */
    private static function truncate(string $value): string {
        $limit = (int) config('access_log.value_limit');
        if (strlen($value) <= $limit) {
            return $value;
        }

        return mb_strcut($value, 0, $limit, 'UTF-8') . self::MARKER;
    }

    /**
     * Replace invalid byte sequences so json_encode cannot fail. The parameter columns are
     * JSON and Eloquent's array cast encodes them; json_encode returns false on malformed
     * UTF-8, which would cost the entire entry (FR-019, research D8).
     */
    private static function coerce(string $value): string {
        return (string) mb_convert_encoding($value, 'UTF-8', 'UTF-8');
    }
}
