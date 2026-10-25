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

/** A watcher has finished its first build when its output says so (ng-packagr, tsc). */
const FIRST_BUILD = /Compilation complete|Built @coolms|Found 0 errors|Watching for file changes/;

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

function run(lib, args, onFirstBuild) {
    const started = Date.now();
    const child = spawn('npm', args, { cwd: join(packages, lib), stdio: ['ignore', 'pipe', 'pipe'] });
    let first = false;
    const read = (chunk) => {
        const text = chunk.toString();
        process.stdout.write(text.split('\n').filter(Boolean).map((l) => `[${lib}] ${l}\n`).join(''));
        if (!first && FIRST_BUILD.test(text)) {
            first = true;
            onFirstBuild?.(Date.now() - started);
        }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    return child;
}

if (mode === 'build') {
    for (const lib of ORDER) {
        const started = Date.now();
        const code = await new Promise((done) => run(lib, ['run', 'build']).on('exit', done));
        if (code !== 0) {
            console.error(`kits: FAILED at ${lib} (exit ${code}); the libraries after it were not built`);
            process.exit(1);
        }
        console.log(`kits: built ${lib} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    console.log(`kits: all ${ORDER.length} built`);
} else {
    const children = [];
    const stop = () => {
        for (const c of children) c.kill('SIGTERM');
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    for (const lib of ORDER) {
        const args = watchArgs(lib);
        if (args === null) {
            console.log(`kits: ${lib} has no watch mode; built once`);
            await new Promise((done) => run(lib, ['run', 'build']).on('exit', done));
            continue;
        }
        await new Promise((ready) => {
            const child = run(lib, args, (ms) => {
                console.log(`kits: watching ${lib} (first build ${(ms / 1000).toFixed(1)} s)`);
                ready();
            });
            children.push(child);
            child.on('exit', (code) => {
                console.error(`kits: the ${lib} watcher stopped (exit ${code})`);
                ready();
            });
        });
    }
    console.log('kits: every library is watching; edit a kit and its dist/ rebuilds');
}
