// @ts-check
/**
 * Ship B — ESLint config for the admin SPA (`coolms/theme-admin`).
 *
 * Extends the framework-agnostic base config at `packages/eslint.config.base.mjs`,
 * then layers Angular-specific rules from `angular-eslint`. When the
 * future `coolms/theme-angular` UI kit package lands, it inherits the
 * same Angular rules from its own `eslint.config.mjs` that extends the
 * same base — one bar, two consumers.
 *
 * **Tiered strictness across directories**:
 *
 * - src/app/shared           → strict (matches future theme-angular UI kit bar)
 * - src/app/core             → recommended-type-checked (services, state)
 * - src/app/features         → recommended-type-checked (volatile pages)
 * - src/app/shell            → the host: composes features, never packaged
 * - core                    -> MOVED to packages/core-angular (@coolms/core-angular)
 * - src/app/coolms-(prefix)  → recommended only (embedded editor packages,
 *                              close to vendored — relaxed bar)
 *
 * Build-gate policy: errors fail the build. Warnings inform but don't
 * block — see base config docblock.
 */

import createBaseConfig from '../../eslint.config.base.mjs';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * `core/` is a package in waiting (`@coolms/core-angular`), so the rest of the
 * app talks to it the way an external consumer would.
 */
const KIT_BARREL_ONLY =
    "Import from '@coolms/ui-angular' instead of reaching into the package -- "
    + 'its public surface is the barrel at packages/ui-angular/src/public-api.ts. '
    + 'A deep path works today only because the kit is compiled from source; it '
    + 'is not reachable from an installed package, so it is not an import the '
    + 'kit supports. If what you need is not exported, exporting it is a '
    + 'deliberate decision about the API.';

const CORE_BARREL_ONLY =
    "Import from '@coolms/core-angular' instead of reaching into core/ -- "
    + "its public surface is the barrel at src/app/core/public-api.ts. If what "
    + "you need is not exported there, exporting it is a deliberate decision "
    + "about the package API, not an import detail.";

/** @type {import('typescript-eslint').ConfigArray} */
export default tseslint.config(
    ...createBaseConfig({ tseslint, globals }),

    // The admin SPA ships without an `ng test` builder wired (see
    // MEMORY.md §"DataGrid Ship C") — spec files exist as executable
    // documentation but aren't included in the build's tsconfig. The
    // type-checked rules would fail with parse errors on those files,
    // so exclude them from lint scope. A future ship that wires Karma
    // / Vitest can extend tsconfig + drop this ignore.
    {
        ignores: ['src/**/*.spec.ts'],
    },

    // Hook the TS parser at the admin tsconfig so type-checked rules can
    // resolve types. The base config's recommendedTypeChecked rules
    // require this to fire.
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@angular-eslint': angular.tsPlugin,
        },
        processor: angular.processInlineTemplates,
        rules: {
            // ----- Angular-recommended baseline -----
            ...angular.configs.tsRecommended.at(-1).rules,

            // ----- Selector prefix: stay lenient for first pass -----
            // The admin SPA mixes `app-*`, `cms-*`, `coolms-*` selectors
            // (the shared `cms-*` chrome predates the lint setup). Don't
            // force a rename in Ship B; cleanup ship can normalise later.
            '@angular-eslint/component-selector': [
                'warn',
                {
                    type: 'element',
                    prefix: ['app', 'cms', 'coolms'],
                    style: 'kebab-case',
                },
            ],
            '@angular-eslint/directive-selector': [
                'warn',
                {
                    type: 'attribute',
                    prefix: ['app', 'cms', 'coolms'],
                    style: 'camelCase',
                },
            ],

            // ----- OnPush is best-practice but pervasive to enforce -----
            // Admin SPA mixes OnPush + Default change detection today.
            // Warn now; promote to error after a sweep.
            '@angular-eslint/prefer-on-push-component-change-detection': 'warn',

            // ----- Angular cosmetic / convention rules — warn first pass -----
            // Each fires under 10 times codebase-wide. A small follow-up
            // cleanup ship promotes them to error after the sweep.
            '@angular-eslint/no-empty-lifecycle-method': 'warn',
            '@angular-eslint/no-output-native': 'warn',
            '@angular-eslint/component-class-suffix': 'warn',
            '@angular-eslint/no-inputs-metadata-property': 'warn',
        },
    },

    // Disable type-checked rules for HTML / inline-template files.
    // Templates don't carry TS type info; the angular-template plugin
    // handles template-specific checks separately in the next block.
    // This MUST come before the rules block below so the rules-merge
    // doesn't undo the disable.
    {
        files: ['**/*.html'],
        ...tseslint.configs.disableTypeChecked,
    },

    // Angular template rules — applies to .html files AND to inline
    // templates extracted by `processInlineTemplates`.
    {
        files: ['**/*.html'],
        languageOptions: {
            parser: angular.templateParser,
        },
        plugins: {
            '@angular-eslint/template': angular.templatePlugin,
        },
        rules: {
            ...angular.configs.templateRecommended.at(-1).rules,

            // Accessibility rules are best-practice but pervasive — warn
            // first pass, promote to error after a11y cleanup ship.
            '@angular-eslint/template/click-events-have-key-events': 'warn',
            '@angular-eslint/template/interactive-supports-focus': 'warn',
            '@angular-eslint/template/alt-text': 'warn',
        },
    },

    // ----- Tier 2: shared primitives — strict bar matching the future UI kit -----
    // When `coolms/theme-angular` lands, this tier extracts into its
    // package's eslint.config.mjs at the same strictness.
    //
    // **Strict rules currently DEFERRED** — the initial baseline surfaced
    // ~360 errors across the shared tier from this group of rules. Ship B
    // (the lint adoption itself) intentionally keeps the bar at
    // recommended-type-checked; the shared-tier cleanup is its own ship.
    // Uncomment when a "shared tier strict-cleanup" ship is scheduled.
    // {
    //     files: ['src/app/shared/**/*.ts'],
    //     rules: {
    //         '@typescript-eslint/no-explicit-any': 'error',
    //         '@typescript-eslint/no-unnecessary-condition': 'error',
    //         '@typescript-eslint/prefer-readonly': 'error',
    //         '@typescript-eslint/strict-boolean-expressions': [
    //             'error',
    //             {
    //                 allowString: true,
    //                 allowNumber: true,
    //                 allowNullableObject: true,
    //             },
    //         ],
    //     },
    // },

    // ----- Codebase-wide pragmatic downgrades for Ship B -----
    // These rules surface real-but-not-blocking patterns; warning makes
    // them visible without failing the build. The "should we tighten?"
    // call is per follow-up ship.
    {
        files: ['**/*.ts'],
        rules: {
            // `passing this.method` to template handlers is idiomatic
            // Angular; the rule fires hundreds of times. Real `this`-
            // scoping bugs from this pattern are rare in Angular
            // components because the framework binds for us.
            '@typescript-eslint/unbound-method': 'warn',

            // Implicit toString in template interpolation is usually
            // intentional; the rule needs more type metadata than HTTP
            // responses currently carry.
            '@typescript-eslint/no-base-to-string': 'warn',

            // 13 remaining after auto-fix — mostly `import { type X }` vs
            // `import type { X }` style nits.
            '@typescript-eslint/consistent-type-imports': 'warn',

            // Auto-fix cleared the easy ones; 30 remain where the type
            // narrowing isn't safe to mechanically rewrite.
            '@typescript-eslint/prefer-nullish-coalescing': 'warn',

            // Type-union simplification — cosmetic. Warn for now.
            '@typescript-eslint/no-redundant-type-constituents': 'warn',

            // Enum vs string comparisons — surface as warn so the cases
            // get scoped manually.
            '@typescript-eslint/no-unsafe-enum-comparison': 'warn',

            // Type-narrowing across signals + RxJS confuses the rule into
            // false positives at the codebase-wide tier. Already warned
            // in the base config; the shared-tier strict override above
            // would have promoted — kept as warn here too.
            '@typescript-eslint/no-unnecessary-condition': 'warn',

            // String-boolean coercion footgun. 173 fires today; pervasive
            // enough to warrant deferring. Keeps Ship B unblocked while
            // surfacing the pattern.
            '@typescript-eslint/strict-boolean-expressions': 'warn',

            // ----- TEMPORARY: bug-catcher rules downgraded for Ship B -----
            // These rules catch real Promise / Observable interop bugs but
            // surface 30+ violations on existing code. Each fix requires
            // reading the call site to choose the right remediation
            // (await vs void vs .catch). Defer the audit to a follow-up
            // "Lint cleanup" ship that PROMOTES these back to error after
            // the codebase sweep. Until then they're visible as warnings.
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-misused-promises': 'warn',
            '@typescript-eslint/require-await': 'warn',
        },
    },

    // ----- The layering boundary, enforced -----
    // `shared/` is the packageable UI kit and `core/` is the layer beneath it,
    // so neither may reach into a feature. Both were dirty until 2026-08-19
    // (36 imports across 23 files); the cleanup moved misfiled contracts out of
    // features, inverted three real dependencies behind tokens, and split the
    // app shell into `src/app/shell/`, which is exempt because composing
    // features is precisely its job.
    //
    // Left as a convention this would rot within a sprint -- every one of those
    // 36 imports was written by someone reaching for the nearest working thing.
    // The fix when this fires is one of: move the contract into `shared/` if it
    // is one, declare a small port and bind it in `app.config.ts`, or put the
    // component in the feature it belongs to.
    //
    // Type-only imports count: a `shared/` file that names a feature's type
    // still cannot compile once the kit is a package on its own.
    // Nothing outside core/ may deep-link past its barrel. That is what makes
    // `core/public-api.ts` core's public SURFACE rather than a convenience
    // re-export: the package can be lifted out without auditing 232 call sites
    // to discover what it has to export.
    {
        files: ['src/app/**/*.ts'],
        ignores: ['src/app/core/**'],
        rules: {
            '@typescript-eslint/no-restricted-imports': ['error', {
                patterns: [
                    {
                        group: ['./core/*', './core/**', '../**/core/*', '../**/core/**',
                            '../**/core-angular/src/**'],
                        message: CORE_BARREL_ONLY,
                    },
                    {
                        // The kit left src/app/shared for packages/ui-angular, so a
                        // relative path into it is now the only way to bypass the
                        // barrel -- and it would keep compiling, which is why it is
                        // worth forbidding rather than trusting.
                        group: ['../**/ui-angular/src/**'],
                        message: KIT_BARREL_ONLY,
                    },
                ],
            }],
        },
    },

    // The kit itself now lives in packages/ui-angular and carries its own
    // eslint config; the rule that kept `shared/` out of `features/` went with
    // it, where it is no longer a convention but a fact of the directory.


    // Tier 3 is gone with the directories it covered. The embedded packages
    // -- document, document-viewer, editor, image-editor, pdf -- were
    // extracted to `packages/` and each carries the relaxed `no-unsafe-*`
    // bar in its own eslint config, where the vendored-ish seams (Fabric.js,
    // PDF.js, codemirror) actually live. `coolms-async` was the last
    // `src/app/coolms-*` directory and it was dead code, so it was deleted
    // rather than extracted. `src/app` is now `api`, `features`, `shell`.
);
