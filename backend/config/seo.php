<?php

declare(strict_types=1);

// Values the SEO shell, sitemap and robots responses are composed from. Every
// one of them is read through config() rather than a constant so tests can point
// `shell_path` at a fixture and shrink `sitemap_chunk` to exercise the chunk
// split, neither of which is reachable with a hard-coded value.
return [
    // Title suffix and JSON-LD publisher name.
    'site_name' => 'online-trash',

    // The generic description served for every non-meme address, and the
    // fallback for a meme that carries no description of its own.
    'site_description' => 'online-trash is an endless feed of memes, pictures and videos. '
        . 'Scroll the trash, share what you like, upload your own.',

    // The built SPA shell (dist/index.html) the php image bakes in at
    // resources/spa/. Dev bind-mounts frontend/index.html here; tests override
    // this key to point at tests/fixtures/spa-shell.html.
    'shell_path' => base_path('resources/spa/index.html'),

    // Branded preview image for pages with no media of their own, absolutised
    // against APP_URL at use time.
    'fallback_image' => '/logo-light.png',

    // URLs per child sitemap. 50,000 is the sitemaps.org protocol maximum.
    'sitemap_chunk' => 50000,

    // Seconds a composed page's metadata stays cached.
    'cache_ttl' => 3600,

    // Seconds a rendered sitemap stays cached. Deliberately LONGER than cache_ttl and
    // longer than the interval crawlers actually re-fetch a child at: production
    // measurement (2026-08-22) put that at roughly 90 minutes, so at the shared
    // hour-long value every single retrieval found the entry expired and re-rendered
    // the whole 315 KB file from the database. The cost of the wider window is bounded
    // staleness — a meme hidden or purged inside it stays listed until the entry turns
    // over, which for the listing is the accepted contract (FR-020 / AS2.5), unlike a
    // permalink's metadata (FR-040), which is why the two intervals are separate keys.
    'sitemap_cache_ttl' => 21600,

    // Shown for a meme with no title; matches the SPA's existing feed fallback
    // (frontend/src/components/FeedItem.tsx), so the unfurl and the rendered
    // page never disagree about what an untitled meme is called.
    'untitled_label' => 'Untitled meme',
];
