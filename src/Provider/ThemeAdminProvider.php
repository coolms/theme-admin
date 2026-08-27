<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\Provider;

use App\Theme\Domain\Provider\ThemeProviderInterface;

/**
 * Registers coolms-admin as a known theme.
 *
 * This is an SPA theme — no DTMPL templates.
 * Assets are produced by `ng build` into packages/theme-admin/public/
 * and copied to public/themes/coolms-admin/ by `coolms:theme:install coolms-admin`.
 */
final class ThemeAdminProvider implements ThemeProviderInterface
{
    public string $slug { get => 'coolms-admin'; }
    public string $themePath { get => ''; }
    public string $manifestPath { get => $this->bundleRoot . '/theme.yaml'; }
    public string $assetsPath { get => $this->bundleRoot . '/public'; }
    public string $assetsUrl { get => '/themes/coolms-admin'; }
    private readonly string $bundleRoot;

    public function __construct()
    {
        $this->bundleRoot = dirname(__DIR__, 2);
    }
}
