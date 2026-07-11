<?php

declare(strict_types=1);

// Runtime env() returns null once `config:cache` is active; anything read outside
// the config/ tree must flow through a config key to survive caching.
return [
    'seed_source' => env('MEDIA_SEED_SOURCE'),
];
