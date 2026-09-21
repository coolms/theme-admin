# Changelog

All notable changes to `coolms/theme-admin` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is described in `CONTRIBUTING.md` -- read it before assuming what a
major number means here.
## Unreleased

### Added
- `npm run lint:fallbacks` (`scripts/check-token-fallbacks.mjs`): every
  `var(--cms-x, fallback)` under `src/` is checked against `styles.scss`. It
  fails on a fallback for a token nothing defines, and on a fallback whose value
  disagrees with the token's -- colours compared as r,g,b, lengths and keywords
  as text; a fallback that is itself `var()` or that abbreviates a multi-part
  token (font stack, shadow list) is left alone. Three fallbacks reached
  `develop` in two weeks with nothing here to refuse them; the local pre-push
  hook now runs this on the tree of every commit being pushed, and refuses when
  that tree has a `styles.scss` and the script is missing.

### Changed
- The mailbox wizard connects an OAuth account BEFORE anything is created. The last
  step of a new OAuth mailbox is "Connect with <provider>": the intended mailbox goes
  to `POST /email/mailboxes/connect`, the browser leaves for the consent screen, and
  the mailbox exists only once the server has proven the grant -- a refused or
  abandoned consent leaves nothing behind, where the previous flow committed a
  "pending" row first and the scheduler then tried to fetch it. Two rules ride
  along: an OAuth mailbox has no username fields at all (it signs in as its
  address); on the password path the username is the address for everyone, and
  only an administrator sees an alias field. The rules are pure functions
  (`mailbox-wizard.util.ts`) with their own spec.
- CDP: the subject `kind` is `anonymous | recognised | known` -- the recognised
  browser (a durable identifier issued on the `recognition` consent rung) gets
  its own badge on the subject page, and the segment editor's example
  expression selects on `subject['kind']`.

### Fixed
- 27 `var()` fallbacks that disagreed with their own token, in 15 files: eleven
  radii (`--cms-radius` is 6px and was written as 4px, 8px and 10px;
  `--cms-radius-sm` is 4px and was written as 6px) and sixteen colours written
  as `transparent`, `inherit` or a translucent `rgba()` under a solid token.
  None of them painted inside the admin, where the theme is always present;
  each would have painted wherever it is not. `lint:tokens` baseline 25 -> 1.

## 2.0.0-alpha5 - 2026-09-09

### Added

**`tests/` is in the package again.** It was excluded on the grounds that
percentages of a 21 MB archive are real megabytes. Re-measured: the whole of
`tests/` is one 3,581-byte file, and adding it moves the archive from 661 files
to 662 and the byte count not at all -- it fits inside tar's existing block
padding. The exception cost a reader their tests and saved nothing, so it is
withdrawn and this package follows the same rule as the rest: tests ship.

The figures in `.gitattributes` justifying the remaining exclusions were also
re-measured. They had drifted when 2.0.0-alpha4 put the built admin in the
package -- the tree roughly doubled and `angular/` stopped being the bulk of it.

### Changed

- 104 internal identifiers are out of the admin sources, and the sentences an
  earlier mechanical strip broke are repaired.
- The application's namespace is out of the last three places that named it.
- The admin asks the server which entity a filter audience is built from,
  instead of comparing against a constant compiled into the published bundle --
  which put a consuming application's class name inside an npm package.
- The space URLs are read from the manifest rather than assembled by the client
  from a URL shape the router owns.
- Three `var()` fallbacks are aligned with the tokens they fall back to.
- "Default" and "Unused" replace "Active" and "Fallback", which described a
  state the UI does not have.
- The admin shell tells crawlers not to index it.
- The shipped admin is rebuilt from the committed source, and a backtick guard
  runs before it can build.

### Removed

- `forgetLastPath` is deleted rather than wired up, and what nothing covers is
  written down instead.

## 2.0.0-alpha4 - 2026-09-04

### Added

**The built admin is in the package.** Until now installing this gave you a
bundle, a route, and nothing to serve: the artefact was gitignored, so it
was in no archive Composer could fetch, and building it needs Node and
roughly 837 MB of `node_modules` -- not something a PHP project does on
`composer install`.

21.03 MB, 650 files, under `public/browser/`. `AdminController` serves it
for every `/admin/**` path, as it always has.

!! **The cost is permanent and worth stating.** 121 bundle names are
content-hashed, so every release rewrites all of them, and git does not
forget. Reversing this later means rewriting history or living with the
objects. It was taken as the least bad of three: making the 14 `@coolms/*`
dependencies real is blocked on a package that is deliberately private and
on export subpaths that are not published, and building in CI is this same
commit made by a machine.

### Changed

**The archive stopped carrying what a PHP consumer cannot use.** The Angular
sources were 502 of 516 tracked files and 13.25 of 13.70 MB; they stay in the
repository and leave the archive. Without that, this release would have
shipped both the sources and the build.

**The vendored document fonts moved to the package that owns them.** They
now come from `coolms/document-fonts`, a new requirement, and
`AdminController` serves `assets/document-fonts/` from there. The URL is
unchanged, so nothing on the client had to learn a new one, and the
containment check that guards the build directory guards the font directory
too. The 24 files in this package had been generated output that was
committed -- byte for byte what the engine already shipped.

**The pdf.js viewer is pinned to one build.** It ships four builds each of
its viewer, worker and sandbox; nothing here selected one, so all of them
were copied. `_internalFilenameSuffix` is `.min` and the library marks it
internal, so the non-minified twins can never be fetched; and `needsES5`
wants IE11, a legacy `Edge/` agent or a browser without `ReadableStream`,
none of which is in a baseline of ES2022 with chrome 109+, firefox 140+ and
ios_saf 26.4+.

Together those are the difference between a 39.36 MB artefact and a 21.03 MB
one, and both were done BEFORE the first commit of it, because git keeps
whatever the first commit contains.

### Fixed

- `theme.yaml` described the panel as Angular 19 against a tree on 22.
## 2.0.0-alpha3 - 2026-09-03

### Fixed

**Declares `symfony/config`, without which this package cannot be loaded at
all.** The bundle class extends `Symfony\Component\HttpKernel\Bundle\Bundle`,
which extends `DependencyInjection\Kernel\AbstractBundle`, which implements
`Config\Definition\ConfigurableInterface` -- and `symfony/dependency-injection`
carries `symfony/config` in **require-dev**, not `require`. So installing
this package on its own produced:

```
Interface "Symfony\Component\Config\Definition\ConfigurableInterface" not found
```

!! **Invisible in any application that installs `symfony/framework-bundle`**,
which pulls `symfony/config` in transitively -- which is every application
this theme had ever been installed into. Found by resolving the package from
its tag into an empty tree and then checking that every `use` statement in
its own `src/` resolves against what that install produced. Installing is not
the check: 2.0.0-alpha2 installed perfectly and could not load its own bundle.

Same class of defect as `coolms/core-bundle` requiring
`symfony/translation-contracts` without `symfony/translation`: a dependency
the host application had been supplying that the manifest never declared.
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

### !! Read this before installing: the built admin is NOT in this package

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
