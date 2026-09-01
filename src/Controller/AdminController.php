<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

use const DIRECTORY_SEPARATOR;

/**
 * Serves the Angular SPA shell and its static assets for all /admin/** paths.
 *
 * The @angular-devkit/build-angular:application builder always emits browser
 * files into a browser/ subdirectory inside the configured outputPath base, so
 * built assets live at packages/theme-admin/public/browser/.
 *
 * All /admin/** requests are caught by this controller. A request that resolves
 * to a real file inside the build output is served with its content type; every
 * other path returns index.html so Angular Router handles it client-side.
 *
 * This used to gate on an extension ALLOWLIST -- js, mjs, css, map, json,
 * ico, png, svg, webp, woff, woff2, ttf, eot, txt -- and the list went stale
 * the moment the build started shipping anything else. MEASURED when that was
 * found: the build ships 13 extensions and the list named 8, so 411 of 648
 * files were unreachable -- 225 .ftl (the pdf.js locale, which is why the PDF
 * zoom dropdown rendered raw l10n ids and blank options), 168 .bcmap (CJK
 * character maps), 14 .pfb (the pdf.js standard fonts) and 4 .wasm (the
 * openjpeg and qcms decoders). Every one of them answered with the SPA shell
 * instead: 200, text/html, 60KB of index.html where a font or a translation
 * was expected.
 *
 * Existence is the test now, so there is no list left to go stale. That makes
 * the containment check load-bearing rather than incidental: realpath()
 * collapses any .. BEFORE the prefix comparison, so a traversal cannot leave
 * the build directory.
 *
 * No Twig dependency -- file_get_contents() is used throughout.
 */
#[Route('/admin', name: 'coolms_admin')]
#[Route('/admin/{path}', name: 'coolms_admin_spa', requirements: ['path' => '.+'])]
final class AdminController
{
    /**
     * Content type per extension, lower-cased.
     *
     * Public because a test asserts it covers every extension the build
     * actually emits -- the mime map is the one keep-list left in this class,
     * and a keep-list that nothing measures is the bug above all over again.
     *
     * wasm MUST be application/wasm. WebAssembly.instantiateStreaming
     * REFUSES any other type, so an octet-stream fallback there is a silent
     * decoder failure rather than a slightly wrong header.
     *
     * @var array<string, string>
     */
    public const array MIME_TYPES = [
        'js' => 'application/javascript; charset=UTF-8',
        'mjs' => 'application/javascript; charset=UTF-8',
        'css' => 'text/css; charset=UTF-8',
        'html' => 'text/html; charset=UTF-8',
        'map' => 'application/json',
        'json' => 'application/json',
        'wasm' => 'application/wasm',
        // pdf.js locale bundles -- Fluent source, fetched as text.
        'ftl' => 'text/plain; charset=UTF-8',
        // pdf.js CJK character maps and Type1 standard fonts: both opaque.
        'bcmap' => 'application/octet-stream',
        'pfb' => 'application/octet-stream',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'png' => 'image/png',
        'gif' => 'image/gif',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
        'avif' => 'image/avif',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
        'otf' => 'font/otf',
        'eot' => 'application/vnd.ms-fontobject',
        'txt' => 'text/plain; charset=UTF-8',
        'xml' => 'application/xml',
    ];

    private readonly string $buildDir;

    public function __construct()
    {
        // packages/theme-admin/public/browser/  -- Angular build output.
        // __DIR__ = .../src/Controller  ->  dirname(2) = package root.
        $this->buildDir = dirname(__DIR__, 2) . '/public/browser';
    }

    public function __invoke(string $path = ''): Response
    {
        $filePath = '' === $path ? null : $this->resolve($path);

        if (null !== $filePath) {
            // is_file() passing does not mean the read succeeds -- permissions,
            // an I/O error, or a rebuild swapping the file between the two
            // calls all return false here.
            $body = file_get_contents($filePath);
            if (false === $body) {
                return new Response('', Response::HTTP_INTERNAL_SERVER_ERROR);
            }

            return new Response(
                $body,
                Response::HTTP_OK,
                ['Content-Type' => $this->mimeType($filePath)],
            );
        }

        // A path that LOOKS like a build asset and did not resolve is a
        // missing asset, not a client-side route. Answering it with the shell
        // returns 200 and 60KB of HTML under the content type the browser
        // asked for, so a stale index.html requesting a chunk that no longer
        // exists surfaces as `Unexpected token '=>'` in a file that was never
        // JavaScript -- a syntax error pointing at a line that does not exist.
        //
        // An Angular route never carries a file extension; every build asset
        // does. That is the whole test, and it needs no list to stay current
        // beyond the mime map this class already has to keep.
        if ('' !== $path && isset(self::MIME_TYPES[$this->extension($path)])) {
            return new Response(
                'Not found in the admin build output.',
                Response::HTTP_NOT_FOUND,
                ['Content-Type' => 'text/plain; charset=UTF-8'],
            );
        }

        // All other requests -> Angular shell.
        $indexPath = $this->buildDir . '/index.html';

        if (!is_file($indexPath)) {
            return new Response(
                '<html><body><p>Admin SPA not built yet.</p>'
                . '<p>Run <code>cd packages/theme-admin/angular && npm run build</code></p>'
                . '</body></html>',
                Response::HTTP_SERVICE_UNAVAILABLE,
                ['Content-Type' => 'text/html'],
            );
        }

        $shell = file_get_contents($indexPath);
        if (false === $shell) {
            return new Response(
                '<html><body><p>Admin SPA shell could not be read.</p></body></html>',
                Response::HTTP_INTERNAL_SERVER_ERROR,
                ['Content-Type' => 'text/html'],
            );
        }

        return new Response(
            $shell,
            Response::HTTP_OK,
            [
                'Content-Type' => 'text/html; charset=UTF-8',
                // index.html is not content-hashed -- must not be cached so browsers
                // always get the latest script/style filenames after a rebuild.
                'Cache-Control' => 'no-store',
            ],
        );
    }

    /**
     * Absolute path of a real file inside the build directory, or null.
     *
     * realpath() resolves `..` and symlinks BEFORE the prefix comparison, which
     * is what makes the comparison a containment check rather than a string
     * test on attacker-supplied text.
     */
    private function resolve(string $path): ?string
    {
        $root = realpath($this->buildDir);
        if (false === $root) {
            return null;
        }

        $candidate = realpath($root . '/' . $path);
        if (false === $candidate || !is_file($candidate)) {
            return null;
        }

        return str_starts_with($candidate, $root . DIRECTORY_SEPARATOR) ? $candidate : null;
    }

    /**
     * Lower-cased extension of a path, or '' when it has none.
     *
     * A client-side route has none, which is what separates it from an asset.
     */
    private function extension(string $path): string
    {
        return strtolower(pathinfo($path, PATHINFO_EXTENSION));
    }

    private function mimeType(string $path): string
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        return self::MIME_TYPES[$extension] ?? 'application/octet-stream';
    }
}
