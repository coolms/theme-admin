/**
 * Every spec in an extracted package must be listed in its bridge file.
 *
 * The karma builder discovers specs under the PROJECT ROOT only, and its
 * `include` will not climb above it: an `../../ui-angular/**` glob is accepted
 * and silently matches nothing. So a package's specs reach the suite only by
 * being imported from a file that IS under the root -- `src/<pkg>-specs.spec.ts`.
 *
 * That list is hand-maintained, and the failure mode when it rots is the worst
 * kind: the suite goes GREEN having run fewer tests. It happened twice --
 * 656 -> 623 when core moved, 656 -> 375 when the UI kit moved -- and both
 * times the only witness was the total, which nobody is watching at the moment
 * a spec is added.
 *
 * So this compares the bridge against the files on disk and fails on either
 * kind of drift: a spec that exists but is not imported (silently not run), or
 * an import naming a spec that no longer exists (a broken build, which is at
 * least loud).
 *
 * Run: npm run lint:specs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACKAGES = join(HERE, '..', '..', '..');

/** bridge file under src/, and the package whose specs it must cover. */
const BRIDGES = [
    { bridge: 'src/core-angular-specs.spec.ts', pkg: 'core-angular' },
    { bridge: 'src/ui-angular-specs.spec.ts',   pkg: 'ui-angular' },
    { bridge: 'src/editor-angular-specs.spec.ts', pkg: 'editor-angular' },
    { bridge: 'src/sheet-editor-angular-specs.spec.ts', pkg: 'sheet-editor-angular' },
];

function specsOnDisk(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...specsOnDisk(full, base));
        } else if (entry.endsWith('.spec.ts')) {
            out.push(relative(base, full).split('\\').join('/').replace(/\.ts$/u, ''));
        }
    }
    return out;
}

let failed = false;

for (const { bridge, pkg } of BRIDGES) {
    const bridgePath = join(HERE, '..', bridge);
    const srcDir = join(PACKAGES, pkg, 'src');

    const onDisk = new Set(specsOnDisk(srcDir));
    const listed = new Set();
    /**
     * Membership is not enough. This check used to compare NAMES only, so a
     * bridge whose every path was one `..` short passed cleanly and the build
     * failed instead -- twice, because the depth from `angular/src/` to
     * `packages/` is THREE. So each specifier is also resolved against disk.
     */
    const unresolved = [];
    for (const m of readFileSync(bridgePath, 'utf8')
        .matchAll(/import '([^']+)';/gu)) {
        const spec = m[1];
        const named = new RegExp(String.raw`/${pkg}/src/(.+)$`, 'u').exec(spec);
        if (named) listed.add(named[1]);
        if (!existsSync(join(HERE, '..', dirname(bridge), `${spec}.ts`))) {
            unresolved.push(spec);
        }
    }

    const missing = [...onDisk].filter((s) => !listed.has(s)).sort();
    const stale = [...listed].filter((s) => !onDisk.has(s)).sort();

    if (missing.length === 0 && stale.length === 0 && unresolved.length === 0) {
        console.log(`✓ ${pkg}: ${onDisk.size} specs, all listed and resolving in ${bridge}`);
        continue;
    }

    failed = true;
    console.error(`\n✘ ${bridge} is out of step with packages/${pkg}/src`);
    for (const s of missing) {
        console.error(`   NOT RUN  ${s}  — add: import '../../../${pkg}/src/${s}';`);
    }
    for (const s of stale) {
        console.error(`   GONE     ${s}  — remove its import`);
    }
    for (const s of unresolved) {
        console.error(`   NO SUCH FILE  ${s}`);
        console.error('                 (it is THREE `..` from angular/src to packages/)');
    }
}

if (failed) {
    console.error(
        '\nA spec that is not imported here does not run, and the suite still'
        + '\nreports SUCCESS. Fix the list above.',
    );
    process.exit(1);
}
