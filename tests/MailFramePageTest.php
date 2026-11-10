<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\Tests;

use CoolMS\ThemeAdmin\Controller\AdminController;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Response;

/**
 * The mail frame pages (the components contract's mail "mail frame page"): the document a message is drawn
 * in, served from the admin's own origin with exactly the contract's policy text, in both variants, and the headers
 * beside it. The policy is written out here, not read from the class: a test that read the constant would follow any
 * change to it.
 */
final class MailFramePageTest extends TestCase
{
    private const string POLICY = "default-src 'none'; script-src 'none'; object-src 'none'; "
        . "frame-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'; "
        . "img-src 'self' data:; frame-ancestors 'self'";

    private const string POLICY_WITH_IMAGES = "default-src 'none'; script-src 'none'; object-src 'none'; "
        . "frame-src 'none'; form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'; "
        . "img-src 'self' data: https:; frame-ancestors 'self'";

    /** The pages as the build ships them: copied from the source the build copies. */
    private const string SOURCE = __DIR__ . '/../angular/public';

    private string $dir;

    /** @return iterable<string, array{string, string}> */
    public static function pages(): iterable
    {
        yield 'mail-frame.html' => ['mail-frame.html', self::POLICY];
        yield 'mail-frame-images.html' => ['mail-frame-images.html', self::POLICY_WITH_IMAGES];
    }

    #[Test]
    #[DataProvider('pages')]
    public function answersWithExactlyTheContractPolicyAndItsHeaders(string $page, string $policy): void
    {
        $response = (new AdminController($this->dir))($page);

        self::assertSame(Response::HTTP_OK, $response->getStatusCode());
        self::assertSame($policy, $response->headers->get('Content-Security-Policy'));
        self::assertCount(1, $response->headers->all('content-security-policy'), 'one policy, not two');
        self::assertSame('no-referrer', $response->headers->get('Referrer-Policy'));
        self::assertSame('SAMEORIGIN', $response->headers->get('X-Frame-Options'));
        self::assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        self::assertStringStartsWith('text/html', (string) $response->headers->get('Content-Type'));
    }

    /** @return iterable<string, array{string}> */
    public static function pageNames(): iterable
    {
        yield 'mail-frame.html' => ['mail-frame.html'];
        yield 'mail-frame-images.html' => ['mail-frame-images.html'];
    }

    /** The page is a document to write into: a doctype, a charset, links opening apart, no base address, no more. */
    #[Test]
    #[DataProvider('pageNames')]
    public function isAMinimalDocumentWithABaseTargetAndNoBaseAddress(string $page): void
    {
        $body = (string) (new AdminController($this->dir))($page)->getContent();

        self::assertStringStartsWith('<!doctype html>', strtolower($body));
        self::assertStringContainsString('<meta charset="utf-8">', $body);
        self::assertStringContainsString('<base target="_blank">', $body);
        self::assertDoesNotMatchRegularExpression('/<base[^>]*\bhref=/i', $body);
        self::assertMatchesRegularExpression('#<body>\s*</body>#', $body);
        self::assertStringNotContainsStringIgnoringCase('<script', $body);
    }

    /** Any other file of the build keeps its own headers: the policy is the frame pages' alone. */
    #[Test]
    public function anyOtherFileCarriesNoneOfThem(): void
    {
        $response = (new AdminController($this->dir))('chunk-Real.js');

        self::assertNull($response->headers->get('Content-Security-Policy'));
        self::assertNull($response->headers->get('Referrer-Policy'));
        self::assertNull($response->headers->get('X-Frame-Options'));
    }

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/admin-frame-fixture-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0o777, true);
        foreach (['mail-frame.html', 'mail-frame-images.html'] as $page) {
            copy(self::SOURCE . '/' . $page, $this->dir . '/' . $page);
        }
        file_put_contents($this->dir . '/chunk-Real.js', 'export const a = 1;');
    }

    protected function tearDown(): void
    {
        foreach (['/mail-frame.html', '/mail-frame-images.html', '/chunk-Real.js'] as $f) {
            if (is_file($this->dir . $f)) {
                unlink($this->dir . $f);
            }
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
    }
}
