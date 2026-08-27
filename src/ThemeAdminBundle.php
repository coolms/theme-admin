<?php

declare(strict_types=1);

namespace CoolMS\ThemeAdmin;

use CoolMS\ThemeAdmin\DependencyInjection\ThemeAdminExtension;
use Symfony\Component\DependencyInjection\Extension\ExtensionInterface;
use Symfony\Component\HttpKernel\Bundle\Bundle;

final class ThemeAdminBundle extends Bundle
{
    public function getContainerExtension(): ExtensionInterface
    {
        return new ThemeAdminExtension();
    }
}
