<?php

declare(strict_types=1);

use Illuminate\Support\Str;

return [
    'lifetime' => (int) env('REMEMBER_ME_LIFETIME', 60 * 24 * 7), // minutes; 7 days
    'cookie' => env('REMEMBER_ME_COOKIE', Str::slug((string) env('APP_NAME', 'laravel')).'-remember'),
];
