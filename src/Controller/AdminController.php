<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Serves the Angular SPA shell and its static assets for all /admin/** paths.
 *
 * The @angular-devkit/build-angular:application builder always emits browser
 * files into a browser/ subdirectory inside the configured outputPath base, so
 * built assets live at packages/theme-admin/public/browser/.
 *
 * All /admin/** requests are caught by this controller. Requests for known
 * static asset extensions (.js, .css, .map, .json, …) are read from the build
 * output directory and served directly with the correct Content-Type.  All
 * other paths return index.html so Angular Router handles them client-side.
 *
 * No Twig dependency — file_get_contents() is used throughout.
 */
#[Route('/admin', name: 'coolms_admin')]
#[Route('/admin/{path}', name: 'coolms_admin_spa', requirements: ['path' => '.+'])]
final class AdminController
{
    private readonly string $buildDir;

    public function __construct()
    {
        // packages/theme-admin/public/browser/  — Angular build output.
        // __DIR__ = .../src/Controller  →  dirname(2) = package root.
        $this->buildDir = dirname(__DIR__, 2) . '/public/browser';
    }

    public function __invoke(string $path = ''): Response
    {
        // Serve static assets directly — Angular build uses hashed filenames so
        // these never collide with SPA routes (e.g. /admin/main-XXXX.js).
        if ('' !== $path && preg_match('/\.(js|mjs|css|map|json|ico|png|svg|webp|woff2?|ttf|eot|txt)$/i', $path)) {
            $filePath = $this->buildDir . '/' . $path;

            if (!is_file($filePath)) {
                return new Response('', Response::HTTP_NOT_FOUND);
            }

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
                ['Content-Type' => $this->mimeType($path)],
            );
        }

        // All other requests → Angular shell.
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
                // index.html is not content-hashed — must not be cached so browsers
                // always get the latest script/style filenames after a rebuild.
                'Cache-Control' => 'no-store',
            ],
        );
    }

    private function mimeType(string $path): string
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'js', 'mjs' => 'application/javascript; charset=UTF-8',
            'css' => 'text/css; charset=UTF-8',
            'map' => 'application/json',
            'json' => 'application/json',
            'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
            'eot' => 'application/vnd.ms-fontobject',
            'txt' => 'text/plain',
            default => 'application/octet-stream',
        };
    }
}
