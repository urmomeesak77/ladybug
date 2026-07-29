<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Composes the served document: the built SPA shell with a real <head>.
 *
 * The only edit made to the template is inside <head> — the existing <title> is
 * removed and the metadata block is injected just before </head>. Everything from
 * </head> onwards, including the root node and the hashed asset tags, is passed
 * through byte for byte (FR-009), so the SPA boots exactly as it does today.
 *
 * Escaping is final here (research D5): attribute values go through
 * htmlspecialchars with ENT_QUOTES | ENT_SUBSTITUTE — ENT_QUOTES closes the
 * attribute-breakout vector, ENT_SUBSTITUTE turns invalid UTF-8 into U+FFFD
 * instead of returning an empty string.
 */
class ShellRenderer {
    public static function render(string $template, PageMeta $meta): string {
        $document = self::stripTitle($template);
        $block = self::headBlock($meta);
        $close = strripos($document, '</head>');

        // No </head> means the template is not the shell we packaged. There is
        // nothing to inject before, so append: the original document survives
        // intact and the metadata is at least present, which beats emitting a
        // silently head-less page.
        if ($close === false) {
            return $document . "\n" . $block . "\n";
        }

        return substr($document, 0, $close) . $block . "\n  " . substr($document, $close);
    }

    /**
     * Remove the shell's own <title>online-trash</title>. Stripping rather than
     * requiring a placeholder keeps frontend/index.html a valid, self-serving
     * document that Vite can go on using in dev.
     */
    private static function stripTitle(string $document): string {
        // The line's own indentation and newline go with it, but no further: the
        // whitespace that indents </head> belongs to </head> and is what the
        // injected block lines up against.
        return (string) preg_replace('#[ \t]*<title\b[^>]*>.*?</title>[ \t]*\r?\n?#is', '', $document, 1);
    }

    /**
     * The metadata block, in the order contracts/shell-response.md fixes it.
     */
    private static function headBlock(PageMeta $meta): string {
        $tags = ['<title>' . self::escape($meta->title) . '</title>'];
        $tags[] = self::meta('name', 'description', $meta->description);
        $tags[] = '<link rel="canonical" href="' . self::escape($meta->canonical) . '">';
        $tags[] = self::meta('property', 'og:type', $meta->ogType);
        $tags[] = self::meta('property', 'og:site_name', (string) config('seo.site_name'));
        $tags[] = self::meta('property', 'og:url', $meta->canonical);
        $tags[] = self::meta('property', 'og:title', $meta->socialTitle);
        $tags[] = self::meta('property', 'og:description', $meta->socialDescription);
        $tags[] = self::meta('property', 'og:image', $meta->imageUrl);
        $tags[] = self::meta('name', 'twitter:card', $meta->isLargeImageCard ? 'summary_large_image' : 'summary');
        $tags[] = self::meta('name', 'twitter:title', $meta->socialTitle);
        $tags[] = self::meta('name', 'twitter:description', $meta->socialDescription);
        $tags[] = self::meta('name', 'twitter:image', $meta->imageUrl);
        if (!$meta->isIndexable) {
            // `follow` deliberately: the page is not worth indexing, but the links
            // out of it (a hidden meme's page still carries the site chrome) are.
            $tags[] = self::meta('name', 'robots', 'noindex, follow');
        }
        if ($meta->structuredData !== null) {
            // Skipped entirely rather than emitted empty, so a non-public meme
            // carries no graph at all (FR-028). The payload is NOT passed through
            // escape(): inside a <script> element the browser decodes no entities,
            // so htmlspecialchars would corrupt the JSON instead of protecting it.
            // StructuredData::encode's flags are what make the block unbreakable.
            $tags[] = '<script type="application/ld+json">'
                . StructuredData::encode($meta->structuredData)
                . '</script>';
        }

        return implode("\n  ", $tags);
    }

    /** One <meta> tag, keyed by `name` or `property` as the vocabulary requires. */
    private static function meta(string $keyAttribute, string $key, string $value): string {
        return sprintf(
            '<meta %s="%s" content="%s">',
            $keyAttribute,
            $key,
            self::escape($value),
        );
    }

    private static function escape(string $value): string {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
