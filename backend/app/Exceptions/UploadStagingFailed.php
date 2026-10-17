<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * The validated upload could not be kept for the queue worker (disk full, unwritable
 * private disk). Raised before anything is dispatched, after the reserved row is removed,
 * so the controller can answer 503 with nothing half-created behind it (024 contract).
 */
final class UploadStagingFailed extends RuntimeException {
}
