/**
 * The assembler, run over fixture trees: what it refuses, by name, and what
 * it writes. `node --test scripts/` (npm run test:scripts).
 *
 * The first case is the one the rule exists for: a theme that declares a
 * contract version the build does not implement is refused at the build,
 * which proves the declaration is read there and not merely stored.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'assemble-console.mjs');

/** A fixture: a root with theme.yaml beside it, a contract file, a modules dir, entry files. */
function fixture({ theme = 'console: "1.0"', contract = '1.0', modules = ['call', 'email'], entries = {} } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'assemble-console-'));
    const root = join(base, 'angular');
    mkdirSync(join(root, 'src', 'app', 'features'), { recursive: true });
    writeFileSync(join(base, 'theme.yaml'), `slug: spec-theme\nfeStack: spa\n${theme ? `contracts:\n  ${theme}\n` : ''}`);
    const contractFile = join(base, 'console-v1.ts');
    writeFileSync(contractFile, `export const CONSOLE_CONTRACT = { name: 'console', version: '${contract}' } as const;\n`);
    const modulesDir = join(base, 'modules');
    for (const m of modules) mkdirSync(join(modulesDir, m), { recursive: true });
    for (const [path, src] of Object.entries(entries)) {
        const file = join(root, 'src', 'app', 'features', path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, src);
    }
    const run = (...extra) => {
        const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--theme', join(base, 'theme.yaml'), '--contract', contractFile, '--modules-dir', modulesDir, ...extra], { encoding: 'utf8' });
        return { code: r.status, out: r.stdout, err: r.stderr, registry: join(root, 'src', 'app', 'console.registry.ts') };
    };
    return { run, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const entry = (module, range = '^1.0') => `import { consoleEntry } from '@coolms/core-angular';\nexport default consoleEntry({ module: '${module}', contract: 'console', range: '${range}' });\n`;

test('a theme declaring a console version the build does not implement is refused, naming both', () => {
    const f = fixture({ theme: 'console: "2.0"', contract: '1.0' });
    try {
        const r = f.run();
        assert.equal(r.code, 1);
        assert.match(r.err, /theme 'spec-theme' declares console 2\.0; the core-angular it compiles against implements console 1\.0 -- refused/);
        assert.equal(existsSync(r.registry), false, 'nothing is written on a refusal');
    } finally { f.cleanup(); }
});

test('a theme that declares no console contract is refused: a declaration nothing reads is a placeholder, and no declaration is worse', () => {
    const f = fixture({ theme: '' });
    try {
        const r = f.run();
        assert.equal(r.code, 1);
        assert.match(r.err, /declares no console contract/);
    } finally { f.cleanup(); }
});

test('an entry whose range this contract does not meet is refused by module name', () => {
    const f = fixture({ entries: { 'call/entries/console.ts': entry('call', '^2.0') } });
    try {
        const r = f.run();
        assert.equal(r.code, 1);
        assert.match(r.err, /module 'call' \(src\/app\/features\/call\/entries\/console\.ts\) offers console \^2\.0; this host implements console 1\.0 -- refused/);
    } finally { f.cleanup(); }
});

test('an entry naming a module the backend does not have is refused', () => {
    const f = fixture({ entries: { 'ghost/entries/console.ts': entry('ghost') } });
    try {
        const r = f.run();
        assert.equal(r.code, 1);
        assert.match(r.err, /module 'ghost' .* has no .*modules\/ghost/);
    } finally { f.cleanup(); }
});

test('two entries for one module are refused, naming both files', () => {
    const f = fixture({ entries: { 'call/entries/console.ts': entry('call'), 'phone/entries/console.ts': entry('call') } });
    try {
        const r = f.run();
        assert.equal(r.code, 1);
        assert.match(r.err, /module 'call' has two entries: src\/app\/features\/call\/entries\/console\.ts and src\/app\/features\/phone\/entries\/console\.ts/);
    } finally { f.cleanup(); }
});

test('the control: entries in feature order become the registry, a spec beside them is not one, and the count is printed', () => {
    const f = fixture({ entries: {
        'email/entries/console.ts': entry('email'),
        'call/entries/console.ts': entry('call', '^1.0'),
        'call/entries/console.phone.ts': entry('phone'),
        'call/entries/console.spec.ts': "describe('the entry', () => {});\n",
    }, modules: ['call', 'email', 'phone'] });
    try {
        const r = f.run();
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /assemble-console: 3 entries \(call \^1\.0, phone \^1\.0, email \^1\.0\); theme 'spec-theme' implements console 1\.0 = core-angular 1\.0; registry written/);
        const registry = readFileSync(r.registry, 'utf8');
        assert.match(registry, /^\/\/ GENERATED by scripts\/assemble-console\.mjs from 3 entry files/);
        assert.match(registry, /import entry_call_entries_console from '\.\/features\/call\/entries\/console';/);
        assert.match(registry, /import entry_call_entries_console_phone from '\.\/features\/call\/entries\/console\.phone';/);
        assert.match(registry, /export const CONSOLE_ENTRIES: readonly ConsoleEntry\[\] = \[entry_call_entries_console, entry_call_entries_console_phone, entry_email_entries_console\];/);
        assert.match(registry, /CONSOLE_BUILT = \{ contract: 'console', version: '1\.0', theme: 'spec-theme', entries: 3 \}/);
        const again = f.run();
        assert.match(again.out, /registry unchanged/);
    } finally { f.cleanup(); }
});

test('no entries is a visible zero, not a silent green', () => {
    const f = fixture();
    try {
        const r = f.run();
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /assemble-console: 0 entries -- the six lists are the shell's own/);
        assert.match(readFileSync(r.registry, 'utf8'), /CONSOLE_ENTRIES: readonly ConsoleEntry\[\] = \[\];/);
    } finally { f.cleanup(); }
});
