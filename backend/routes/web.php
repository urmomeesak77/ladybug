<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

Route::get('/', static function () {
    // The API origin has no web UI; the stock welcome view would advertise
    // framework and PHP versions to anyone probing the root.
    abort(404);
});
