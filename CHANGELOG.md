# Changelog

All notable changes to `coolms/theme-admin` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is described in `CONTRIBUTING.md` -- read it before assuming what a
major number means here.
## 2.0.0-alpha2 - 2026-09-03

**First published release.** Nothing before this was ever released, so there
is no earlier history to describe.

**A pre-release. It carries no compatibility promise**, which is the honest
statement of where the platform is: the shape is still moving, and a stable
tag would be a promise that cannot be kept yet.

Composer will not install it under default stability. Set

```json
"minimum-stability": "alpha",
"prefer-stable": true
```

in your root `composer.json`, then:

```
composer require coolms/theme-admin:^2.0
```

### ⚠️ Read this before installing: the built admin is NOT in this package

What you get is the Symfony side -- 4 PHP classes (bundle, extension,
controller glue), `theme.yaml`, and **500 tracked files of Angular source**
under `angular/`.

What you do not get is the admin itself. The build output lives in
`public/`, it is gitignored, and it is therefore in no archive Composer can
fetch. Installing this package gives you a registered bundle and a route
that serves nothing.

Nor can you currently build it yourself from this package alone: the Angular
app imports **14 `@coolms/*` specifiers at 475 sites across 301 files** and
declares **none** of them in any manifest -- they resolve through `tsconfig`
path mappings onto source directories that are not part of this package and
are not published anywhere a build could fetch them from.

This is a known and undecided question, not an oversight. It is published
now so that the rest of the set is installable and so the gap is visible
rather than implied.

### Version

Starts at 2.0.0: the theme requires `coolms/core` and is a lockstep member.

### Fixed

- `theme.yaml` described the panel as **Angular 19**. It has been on Angular
  22 since 2026-08-26. The manifest is read by `ThemeManifestReader` and
  surfaced in the admin, so the stale number was visible rather than inert.
  The version number is dropped from the description entirely -- a number in
  prose is a thing to get wrong again.
- `theme.yaml` carried `version: 1.0.0`, which would have disagreed with this
  package's own tag from the moment it was cut.
