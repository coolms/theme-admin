<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\Tests;

use CoolMS\ThemeAdmin\Controller\AdminController;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Response;

/**
 * What a /admin/** request receives.
 *
 * Written against a fixture rather than the real build output, so it runs in a
 * clean checkout where `ng build` has never been executed -- which is what CI
 * gets.
 */
final class AdminControllerTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/admin-fixture-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0o777, true);
        file_put_contents($this->dir . '/index.html', '<html><body>shell</body></html>');
        file_put_contents($this->dir . '/chunk-Real.js', 'export const a = 1;');
    }

    protected function tearDown(): void
    {
        // Deepest first: removing a parent before its children is a warning,
        // and this package's phpunit config turns warnings into failures.
        foreach (['/chunk-Real.js', '/index.html'] as $f) {
            if (is_file($this->dir . $f)) {
                unlink($this->dir . $f);
            }
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
    }

    #[Test]
    public function aMissingAssetIs404AndNotTheShell(): void
    {
        $response = (new AdminController($this->dir))('chunk-Gone.js');

        // The failure this prevents: 200 with the SPA shell under
        // `application/javascript`, which a browser reports as a syntax error
        // at a line that does not exist. A stale index.html asking for a
        // rebuilt-away chunk is the ordinary way to reach it.
        self::assertSame(Response::HTTP_NOT_FOUND, $response->getStatusCode());
        self::assertStringNotContainsString(
            '<html',
            (string) $response->getContent(),
        );
    }

    #[Test]
    public function aClientSideRouteGetsTheShell(): void
    {
        // The other half: a rule that 404s anything unresolved would pass the
        // test above and break every deep link. A route carries no extension.
        $response = (new AdminController($this->dir))('navi/trees/42');

        self::assertSame(Response::HTTP_OK, $response->getStatusCode());
        self::assertStringContainsString('shell', (string) $response->getContent());
        self::assertStringContainsString(
            'text/html',
            (string) $response->headers->get('Content-Type'),
        );
    }

    #[Test]
    public function aRealAssetIsServedWithItsOwnContentType(): void
    {
        $response = (new AdminController($this->dir))('chunk-Real.js');

        self::assertSame(Response::HTTP_OK, $response->getStatusCode());
        self::assertSame('export const a = 1;', (string) $response->getContent());
        self::assertStringContainsString(
            'application/javascript',
            (string) $response->headers->get('Content-Type'),
        );
    }

    #[Test]
    public function aTraversalCannotLeaveTheBuildDirectory(): void
    {
        // The containment check is load-bearing now that existence is the only
        // other test: realpath() collapses the .. before the prefix compare.
        $response = (new AdminController($this->dir))('../../composer.json');

        self::assertNotSame(
            Response::HTTP_OK,
            $response->getStatusCode(),
            'A traversal must not be served, even though the target exists.',
        );
    }
}
