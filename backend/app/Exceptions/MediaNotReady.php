<?php

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * A moderator tried to activate a post whose media is still processing or failed (024
 * FR-008). Raised inside the locked transition so nothing is written; the controller turns
 * it into a 409.
 */
final class MediaNotReady extends RuntimeException {
}
