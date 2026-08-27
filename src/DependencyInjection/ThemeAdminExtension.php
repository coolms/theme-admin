<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin\DependencyInjection;

use CoolMS\ThemeAdmin\Controller\AdminController;
use CoolMS\ThemeAdmin\Provider\ThemeAdminProvider;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Extension\Extension;

final class ThemeAdminExtension extends Extension
{
    public function load(array $configs, ContainerBuilder $container): void
    {
        $container->register(ThemeAdminProvider::class)
            ->setAutowired(false)
            ->setAutoconfigured(true)
            ->setPublic(false);

        $container->register(AdminController::class)
            ->setAutowired(false)
            ->setAutoconfigured(true)
            ->setPublic(true);
    }

    public function getAlias(): string
    {
        return 'coolms_theme_admin';
    }
}
