#!/usr/bin/env node
// kits.mjs build|watch -- the frontend libraries the admin compiles, built as LIBRARIES (their own `npm run build`:
// ng-packagr, tsc, esbuild) in dependency order: each builds against its peers' built dist/ (their tsconfig.lib.json
// paths), so a library never starts before the ones it imports.
//
//   build  one pass, in order; stops at the first library that fails and names it. Exit 0 all built, 1 one failed.
//   watch  each library in watch mode, started only after the one before it has finished its first build, so an edit
//          to a kit rebuilds its dist/ in seconds. Runs until stopped (Ctrl-C stops every watcher).
//
// The libraries are the admin's siblings (../../<name>, as the served layout and the CI checkout have them).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, '../../..');

/** The order the libraries' imports require: a library's peers come before it. */
export const ORDER = [
    'core-angular',
    'document-engine',
    'editor-angular',          // core-angular, document-engine
    'ui-angular',              // core-angular, editor-angular (its two rich-text fields)
    'document-viewer-angular', // core-angular, ui-angular
    'pdf-angular',             // core-angular, document-viewer-angular
    'sheet-editor-angular',    // core-angular, ui-angular, document-engine
    'image-editor-angular',    // ui-angular
    'dtmpl-angular',           // core, ui, editor, pdf
    'document-angular',
    'designer',
];

/** How each library watches: ng-packagr and tsc take a flag; esbuild-built designer has no watch of its own. */
const WATCH = {
    'document-engine': ['run', 'build', '--', '--watch', '--preserveWatchOutput'],
    designer: null,
};
const watchArgs = (lib) => (lib in WATCH ? WATCH[lib] : ['run', 'build', '--', '--watch']);

/**
 * How a watcher's first build ended, read from everything it has printed so far (a line may arrive split across
 * chunks): built, failed, or not yet. tsc prints "Watching for file changes" after a FAILED build too, so only
 * "Found 0 errors" counts as built for it; ng-packagr prints "Built @coolms/..." when it built and error output when not.
 */
const BUILT = /Built @coolms\/|Compilation complete|Found 0 errors/;
const FAILED = /Found [1-9]\d* errors?|BUILD ERROR|error TS\d+|ERROR:|✖/;
const FIRST_BUILD_CAP_MS = 300_000;

const mode = process.argv[2];
if (mode !== 'build' && mode !== 'watch') {
    console.error('usage: node scripts/kits.mjs build|watch');
    process.exit(2);
}

const missing = ORDER.filter((lib) => !existsSync(join(packages, lib, 'package.json')));
if (missing.length > 0) {
    console.error(`kits: UNEVALUABLE -- not beside the admin: ${missing.join(', ')}`);
    process.exit(2);
}

/** Runs `npm <args>` in a library, its output prefixed; `onFirst` is told once how the first build ended. */
function run(lib, args, onFirst) {
    const started = Date.now();
    const child = spawn('npm', args, { cwd: join(packages, lib), stdio: ['ignore', 'pipe', 'pipe'] });
    let seen = '';
    let told = false;
    const tell = (outcome) => {
        if (!told) {
            told = true;
            onFirst?.(outcome, Date.now() - started);
        }
    };
    const read = (chunk) => {
        const text = chunk.toString();
        process.stdout.write(text.split('\n').filter(Boolean).map((l) => `[${lib}] ${l}\n`).join(''));
        if (told) return; // only the first build is read; a watcher's output is not kept all day
        seen += text;
        // A failure is read first: a failed build may also print words a built one does.
        if (FAILED.test(seen)) tell('failed');
        else if (BUILT.test(seen)) tell('built');
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => tell(code === 0 ? 'built' : 'failed'));
    return { child, tell };
}

/** Stops every watcher and waits for them to exit, at most a few seconds. */
async function stopAll(children) {
    await Promise.all(children.map((c) => new Promise((done) => {
        if (c.exitCode !== null) return done();
        const cap = setTimeout(() => {
            c.kill('SIGKILL');
            done();
        }, 5000);
        c.once('exit', () => {
            clearTimeout(cap);
            done();
        });
        c.kill('SIGTERM');
    })));
}

if (mode === 'build') {
    for (const lib of ORDER) {
        const started = Date.now();
        const code = await new Promise((done) => run(lib, ['run', 'build']).child.on('exit', done));
        if (code !== 0) {
            console.error(`kits: FAILED at ${lib} (exit ${code}); the libraries after it were not built`);
            process.exit(1);
        }
        console.log(`kits: built ${lib} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    console.log(`kits: all ${ORDER.length} built`);
} else {
    const children = [];
    const stop = async (code) => {
        await stopAll(children);
        process.exit(code);
    };
    process.on('SIGINT', () => void stop(0));
    process.on('SIGTERM', () => void stop(0));
    for (const lib of ORDER) {
        const args = watchArgs(lib);
        if (args === null) {
            const code = await new Promise((done) => run(lib, ['run', 'build']).child.on('exit', done));
            if (code !== 0) {
                console.error(`kits: FAILED at ${lib} (exit ${code}); every watcher stopped`);
                await stop(1);
            }
            console.log(`kits: ${lib} has no watch mode; built once`);
            continue;
        }
        // A library's dependents start only once its first build is BUILT; a failed or never-finished first build
        // stops every watcher and names the library, as build mode does.
        const { child, outcome, ms } = await new Promise((settle) => {
            let cap;
            const started = run(lib, args, (result, took) => {
                clearTimeout(cap);
                settle({ child: started.child, outcome: result, ms: took });
            });
            children.push(started.child);
            cap = setTimeout(() => started.tell('timed out'), FIRST_BUILD_CAP_MS);
        });
        if (outcome !== 'built') {
            console.error(`kits: ${outcome === 'failed' ? 'FAILED' : 'TIMED OUT'} at ${lib}'s first build `
                + `(${(ms / 1000).toFixed(1)} s); every watcher stopped`);
            await stop(1);
        }
        console.log(`kits: watching ${lib} (first build ${(ms / 1000).toFixed(1)} s)`);
        child.on('exit', (code) => console.error(`kits: the ${lib} watcher stopped (exit ${code})`));
    }
    console.log('kits: every library is watching; edit a kit and its dist/ rebuilds');
}
