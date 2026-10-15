/**
 * Which repository each spec of the admin's suite comes from, counted as the suite runs, so a repository whose specs
 * stop running shows as a drop -- the total alone hid it twice (656 -> 623 when core moved, 656 -> 375 when the UI kit
 * moved), and a check that runs nowhere cannot fail.
 *
 * A bridge (`src/<repo>-specs.spec.ts`) imports its marker (`./spec-origin/<repo>`) FIRST: the marker sets the current
 * repository, every `it` registered while its specs load is recorded under it, and the bridge's body -- which runs
 * after all its imports -- ends it. A spec no bridge loaded is the admin's own. At the end of the run the counts are
 * written to the browser console as one line, `SPECS BY REPOSITORY {...}`, which the suite's report reads and holds
 * against `spec-floors.json`.
 */

interface SpecMetadata {
    readonly id: string;
}

interface SpecResult {
    readonly id: string;
    readonly status: string;
}

type SpecFn = (...args: unknown[]) => SpecMetadata | undefined;

const OWN = 'theme-admin';
let current = OWN;
let installed = false;
const origins = new Map<string, string>();

/** The repository whose specs load next, until {@link endSpecOrigin}. */
export function beginSpecOrigin(repository: string): void {
    install();
    current = repository;
}

/** The specs that load from here on are the admin's own again. */
export function endSpecOrigin(): void {
    current = OWN;
}

function install(): void {
    if (installed) {
        return;
    }
    installed = true;
    const scope = globalThis as unknown as Record<string, SpecFn>;
    for (const name of ['it', 'fit', 'xit']) {
        const original = scope[name];
        scope[name] = function (this: unknown, ...args: unknown[]) {
            const spec = original.apply(this, args);
            if (spec?.id) {
                origins.set(spec.id, current);
            }
            return spec;
        };
    }
    const counts: Record<string, { executed: number; failed: number; skipped: number }> = {};
    jasmine.getEnv().addReporter({
        specDone(result: SpecResult): void {
            const repository = origins.get(result.id) ?? OWN;
            const count = (counts[repository] ??= { executed: 0, failed: 0, skipped: 0 });
            if (result.status === 'passed' || result.status === 'failed') {
                count.executed++;
            } else {
                count.skipped++;
            }
            if (result.status === 'failed') {
                count.failed++;
            }
        },
        jasmineDone(): void {
            console.log('SPECS BY REPOSITORY ' + JSON.stringify(counts));
        },
    } as jasmine.CustomReporter);
}
