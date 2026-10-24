// npm test: the unit suite, leaving no build output behind.
//
// @angular/build's karma builder writes each run to dist/test-out/<random uuid> and removes it only on a normal
// process exit. A run stopped by a signal (Ctrl-C, a timeout, a container stopped mid-run) left its directory, and
// on 2026-10-24 one clone held 39,218 such files (4.2 GiB) -- under a path every IDE indexing the package reads.
// So this runs the suite and then removes what appeared in dist/test-out during the run, however the run ended --
// including when the process that started it dies without passing a signal on (npm does, on SIGTERM). Before it
// starts, it removes what earlier runs left -- a run killed outright (SIGKILL, a container ending) cannot clean up:
// everything, when no other run is going on in this tree (dist/.runs holds a marker per running run); else only what
// no run has touched for an hour, so a run going on at the same time keeps its own directory.
//
// Run: npm test [-- <ng test options>]. TEST_COMMAND (a JSON array) replaces `ng test --watch=false`, for the tests.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STALE_MS = 60 * 60 * 1000;
export const ORPHAN_POLL_MS = 500;

const entries = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

/** Whether a process with this pid is running (a pid the system will not signal, EPERM, is one). */
function alive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
}

/** Removes dist/ when the cleanup left it empty: it never holds anything else in this project. */
function pruneEmpty(out) {
    for (const dir of [out, dirname(out)]) {
        try {
            rmdirSync(dir);
        } catch {
            return;
        }
    }
}

/** Runs `command` in `cwd`, cleaning dist/test-out as described above; resolves to the exit code to use. */
export function runTests({ cwd, command, now = Date.now(), log = () => undefined }) {
    const out = join(cwd, 'dist', 'test-out');
    const runs = join(cwd, 'dist', '.runs');
    // Each run marks itself with its pid while it runs. With no other run alive, everything in test-out is a leftover
    // (a run killed outright cannot clean up: SIGKILL, a container ending); with one alive, only what no run has
    // touched for an hour is, so its own output stays.
    const others = entries(runs).filter((pid) => {
        if (alive(Number(pid))) return true;
        rmSync(join(runs, pid), { force: true });
        return false;
    });
    for (const name of entries(out)) {
        const path = join(out, name);
        if (others.length === 0 || now - statSync(path).mtimeMs > STALE_MS) {
            rmSync(path, { recursive: true, force: true });
            log(`run-tests: removed a leftover run, dist/test-out/${name}`);
        }
    }
    mkdirSync(runs, { recursive: true });
    const marker = join(runs, String(process.pid));
    writeFileSync(marker, '');
    const before = new Set(entries(out));
    return new Promise((resolve) => {
        const child = spawn(command[0], command.slice(1), { cwd, stdio: 'inherit' });
        const forward = (signal) => child.kill(signal);
        process.on('SIGINT', forward);
        process.on('SIGTERM', forward);
        // npm (11) dies of a SIGTERM sent to it alone without passing it on, and so does the shell it runs this in:
        // the run went on, orphaned, until something killed it outright, and its output stayed (measured 2026-10-24).
        // An orphaned run is a stopped one: its parent changing ends the suite as a SIGTERM would.
        const parent = process.ppid;
        const orphaned = setInterval(() => {
            if (process.ppid === parent) return;
            clearInterval(orphaned);
            log(`run-tests: the process that ran this (${parent}) is gone; stopping the run`);
            forward('SIGTERM');
        }, ORPHAN_POLL_MS);
        orphaned.unref();
        let ended = false;
        const done = (code) => {
            if (ended) return;
            ended = true;
            clearInterval(orphaned);
            process.off('SIGINT', forward);
            process.off('SIGTERM', forward);
            for (const name of entries(out)) {
                if (!before.has(name)) rmSync(join(out, name), { recursive: true, force: true });
            }
            rmSync(marker, { force: true });
            pruneEmpty(runs);
            pruneEmpty(out);
            resolve(code);
        };
        child.on('error', (e) => {
            log(`run-tests: ${command[0]} could not start: ${e.message}`);
            done(127);
        });
        child.on('exit', (code, signal) => done(code ?? 128 + (osConstants.signals[signal] ?? 15)));
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const cwd = join(dirname(fileURLToPath(import.meta.url)), '..');
    const command = process.env.TEST_COMMAND
        ? JSON.parse(process.env.TEST_COMMAND)
        : [join(cwd, 'node_modules', '.bin', 'ng'), 'test', '--watch=false', ...process.argv.slice(2)];
    process.exitCode = await runTests({ cwd, command, log: (line) => console.error(line) });
}
