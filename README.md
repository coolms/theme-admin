# coolms/theme-admin

[![CI](https://github.com/coolms/theme-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/coolms/theme-admin/actions/workflows/ci.yml)
[![PHP](https://img.shields.io/badge/php-%E2%89%A5%208.5-777bb4)](https://www.php.net/releases/8.5/en.php)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Angular 22 administration SPA for CoolMS 2.0**

A theme is not a module. It owns no domain and no storage: it implements a small
provider port, ships templates and assets, and wires them into the container.
That is why this package extends Symfony's `Bundle` rather than
`AbstractCoolmsBundle`, and why it requires `coolms/core` -- the contract -- and
not `coolms/coolms`, which is a deployment.

## Installation

```bash
composer require coolms/theme-admin
```

```php
// config/bundles.php
CoolMS\ThemeAdmin\ThemeAdminBundle::class => ['all' => true],
```

```bash
bin/console coolms:theme:install coolms-admin
bin/console coolms:theme:activate coolms-admin
```

## What it is

| | |
|---|---|
| slug | `coolms-admin` |
| front-end stack | `spa` |
| manifest | `theme.yaml` |

## Contracts it implements

- `CoolMS\Core\Theme\ThemeProviderInterface`

Both live in `coolms/core` as of. Before that they were application
classes, which is what made a theme unpublishable.

## Branches

`develop` is the default and where work lands; `main` carries releases. The
package is not tagged yet -- the platform generation ships as `2.0.0-alpha.N`
first, and the lockstep set is tagged together.
