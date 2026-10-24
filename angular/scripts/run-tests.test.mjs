// npm test leaves no build output behind, however the run ends.
// Run: npm run test:scripts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { STALE_MS, runTests } from './run-tests.mjs';

const SCRIPT = fileURLToPath(new URL('./run-tests.mjs', import.meta.url));

/** A stand-in for the karma builder: writes dist/test-out/<name>/main.js, then exits with `code` or waits. */
const builder = (name, then) => [process.execPath, '-e', `
    const fs = require('node:fs');
    fs.mkdirSync('dist/test-out/${name}', { recursive: true });
    fs.writeFileSync('dist/test-out/${name}/main.js', 'built');
    fs.writeFileSync('built-${name}', String(process.pid));
    ${then === 'wait' ? 'console.log("built"); setInterval(() => undefined, 1000);'
        : typeof then === 'object' ? `console.log("built"); setTimeout(() => process.exit(0), ${then.exitAfter});`
            : `process.exit(${then});`}
`];

const project = () => mkdtempSync(join(tmpdir(), 'run-tests-'));
const testOut = (cwd) => (existsSync(join(cwd, 'dist', 'test-out')) ? readdirSync(join(cwd, 'dist', 'test-out')) : null);

/**
 * The wrapper as `npm test` runs it -- from the project's own scripts/, which is how it finds the project -- stopped
 * with `signal` once the stand-in has built.
 */
function interrupted(cwd, name, signal) {
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(cwd, 'scripts', 'run-tests.mjs'));
    return new Promise((resolve) => {
        const run = spawn(process.execPath, [join(cwd, 'scripts', 'run-tests.mjs')], {
            cwd, env: { ...process.env, TEST_COMMAND: JSON.stringify(builder(name, 'wait')) }, stdio: ['ignore', 'pipe', 'ignore'],
        });
        run.stdout.on('data', (chunk) => {
            if (String(chunk).includes('built')) run.kill(signal);
        });
        run.on('exit', (code, sig) => {
            // A wrapper that died without stopping the stand-in leaves it running: stop it here, so the case
            // fails on its assertions instead of hanging.
            try {
                process.kill(Number(readFileSync(join(cwd, `built-${name}`), 'utf8')), 'SIGKILL');
            } catch {
                // already gone, as it should be
            }
            run.stdout.destroy();
            resolve({ code, sig });
        });
    });
}

test('a run that leaves its output: the output goes, and the run\'s exit code is kept', async () => {
    const cwd = project();
    assert.equal(await runTests({ cwd, command: builder('a', 3) }), 3);
    assert.equal(testOut(cwd), null);
    assert.equal(existsSync(join(cwd, 'dist')), false);
    rmSync(cwd, { recursive: true });
});

test('two runs in a row, the first interrupted (Ctrl-C) and the second stopped (SIGTERM): no test-out after either', async () => {
    const cwd = project();
    const first = await interrupted(cwd, 'first', 'SIGINT');
    assert.equal(existsSync(join(cwd, 'built-first')), true, 'the stand-in built in this project');
    assert.equal(testOut(cwd), null, 'after the interrupted run');
    assert.equal(first.code, 130);
    const second = await interrupted(cwd, 'second', 'SIGTERM');
    assert.equal(existsSync(join(cwd, 'built-second')), true, 'the stand-in built in this project');
    assert.equal(testOut(cwd), null, 'after the stopped run');
    assert.equal(second.code, 143);
    rmSync(cwd, { recursive: true });
});

test('the process that ran it dies alone, passing nothing on (npm on SIGTERM): the run stops and its output goes', async () => {
    const cwd = project();
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(cwd, 'scripts', 'run-tests.mjs'));
    // A parent like npm's shell: it runs the wrapper as a child (`; true` keeps sh from exec-ing it) and is then
    // killed outright, so no signal reaches the wrapper.
    const parent = spawn('sh', ['-c', `"${process.execPath}" scripts/run-tests.mjs; true`], {
        cwd, env: { ...process.env, TEST_COMMAND: JSON.stringify(builder('orphan', 'wait')) }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((resolve) => parent.stdout.on('data', (chunk) => String(chunk).includes('built') && resolve()));
    const standIn = Number(readFileSync(join(cwd, 'built-orphan'), 'utf8'));
    parent.kill('SIGKILL');
    const alive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };
    for (let i = 0; i < 50 && (alive(standIn) || testOut(cwd) !== null); i++) await new Promise((r) => setTimeout(r, 100));
    const left = testOut(cwd);
    if (alive(standIn)) process.kill(standIn, 'SIGKILL');
    parent.stdout.destroy();
    assert.equal(alive(standIn), false, 'the stand-in was stopped');
    assert.equal(left, null, 'no test-out left');
    rmSync(cwd, { recursive: true });
});

test('two runs in a row, the first killed outright (SIGKILL, nothing cleans): the second removes what it left', async () => {
    const cwd = project();
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(cwd, 'scripts', 'run-tests.mjs'));
    const first = spawn(process.execPath, ['scripts/run-tests.mjs'], {
        cwd, env: { ...process.env, TEST_COMMAND: JSON.stringify(builder('killed', 'wait')) }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((resolve) => first.stdout.on('data', (chunk) => String(chunk).includes('built') && resolve()));
    const standIn = Number(readFileSync(join(cwd, 'built-killed'), 'utf8'));
    first.kill('SIGKILL');
    process.kill(standIn, 'SIGKILL');
    await new Promise((resolve) => first.on('exit', resolve));
    first.stdout.destroy();
    assert.deepEqual(testOut(cwd), ['killed'], 'the killed run left its output');
    assert.equal(await runTests({ cwd, command: builder('second', 0) }), 0);
    assert.equal(testOut(cwd), null, 'after the second run');
    assert.equal(existsSync(join(cwd, 'dist')), false);
    rmSync(cwd, { recursive: true });
});

test('another run going on in the tree: its fresh output stays, and only what is an hour old goes', async () => {
    const cwd = project();
    for (const name of ['old', 'live']) {
        mkdirSync(join(cwd, 'dist', 'test-out', name), { recursive: true });
        writeFileSync(join(cwd, 'dist', 'test-out', name, 'main.js'), 'built');
    }
    const hourAgo = (Date.now() - STALE_MS - 60_000) / 1000;
    utimesSync(join(cwd, 'dist', 'test-out', 'old'), hourAgo, hourAgo);
    const other = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
    mkdirSync(join(cwd, 'dist', '.runs'), { recursive: true });
    writeFileSync(join(cwd, 'dist', '.runs', `${hostname()}-${other.pid}`), '');
    assert.equal(await runTests({ cwd, command: builder('mine', 0) }), 0);
    other.kill('SIGKILL');
    assert.deepEqual(testOut(cwd).sort(), ['live', 'mine'], 'the old one went; the live run\'s stayed, and so did this run\'s, left to the run that ends last');
    assert.deepEqual(readdirSync(join(cwd, 'dist', '.runs')), [`${hostname()}-${other.pid}`], 'only the other run is marked');
    rmSync(cwd, { recursive: true });
});

test('a run that starts mid-run keeps its output when the first one ends; the last to end removes both', async () => {
    const cwd = project();
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(cwd, 'scripts', 'run-tests.mjs'));
    const start = (name, ms) => {
        const run = spawn(process.execPath, ['scripts/run-tests.mjs'], {
            cwd, env: { ...process.env, TEST_COMMAND: JSON.stringify(builder(name, { exitAfter: ms })) }, stdio: ['ignore', 'pipe', 'ignore'],
        });
        const built = new Promise((resolve) => run.stdout.on('data', (chunk) => String(chunk).includes('built') && resolve()));
        const ended = new Promise((resolve) => run.on('exit', (code) => resolve(code)));
        return { built, ended };
    };
    const a = start('a', 1500);
    await a.built;
    const b = start('b', 4000);
    await b.built;
    assert.equal(await a.ended, 0);
    assert.ok((testOut(cwd) ?? []).includes('b'), 'after the first run ended, the second run\'s output is still there');
    assert.equal(await b.ended, 0);
    assert.equal(testOut(cwd), null, 'after the last run ended');
    assert.equal(existsSync(join(cwd, 'dist')), false);
    rmSync(cwd, { recursive: true });
});

test('a marker from another host (a container\'s pid, unreadable here) counts as live until it is an hour old', async () => {
    const cwd = project();
    mkdirSync(join(cwd, 'dist', 'test-out', 'theirs'), { recursive: true });
    mkdirSync(join(cwd, 'dist', '.runs'), { recursive: true });
    const foreign = join(cwd, 'dist', '.runs', 'another-host-4242');
    writeFileSync(foreign, '');
    assert.equal(await runTests({ cwd, command: builder('mine', 0) }), 0);
    assert.deepEqual(testOut(cwd).sort(), ['mine', 'theirs'], 'a fresh foreign marker keeps the fresh output, this run\'s too');
    const hourAgo = (Date.now() - STALE_MS - 60_000) / 1000;
    utimesSync(foreign, hourAgo, hourAgo);
    assert.equal(await runTests({ cwd, command: builder('mine', 0) }), 0);
    assert.equal(existsSync(join(cwd, 'dist')), false, 'an hour-old foreign marker is gone, and everything with it');
    rmSync(cwd, { recursive: true });
});

test('a marker whose run is gone counts for nothing: everything left goes, and the marker too', async () => {
    const cwd = project();
    mkdirSync(join(cwd, 'dist', 'test-out', 'left'), { recursive: true });
    mkdirSync(join(cwd, 'dist', '.runs'), { recursive: true });
    const gone = spawn(process.execPath, ['-e', '0']);
    await new Promise((resolve) => gone.on('exit', resolve));
    writeFileSync(join(cwd, 'dist', '.runs', `${hostname()}-${gone.pid}`), '');
    assert.equal(await runTests({ cwd, command: builder('mine', 0) }), 0);
    assert.equal(existsSync(join(cwd, 'dist')), false);
    rmSync(cwd, { recursive: true });
});

test('a command that cannot start: 127, and nothing left', async () => {
    const cwd = project();
    assert.equal(await runTests({ cwd, command: [join(cwd, 'no-such-ng')] }), 127);
    assert.equal(testOut(cwd), null);
    rmSync(cwd, { recursive: true });
});
