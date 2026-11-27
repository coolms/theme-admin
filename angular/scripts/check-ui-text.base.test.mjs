// The check's --base, through main(), against a repository made here: an angular/ folder with the grandfather list on a
// base commit and the branch after it. Run: node --test scripts/check-ui-text.base.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), 'check-ui-text.mjs');
const DONE = 'src/a.html\tSaved — done';
const INBOX = 'src/b.html\tMail -- Inbox';

/** A repository whose angular/ folder holds these templates and lists these entries, committed and tagged `base`. */
function repo(files, listed) {
    const top = mkdtempSync(join(tmpdir(), 'ui-text-base-'));
    const root = join(top, 'angular');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const git = (...args) => {
        const run = spawnSync('git', ['-C', top, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
    };
    const write = (f, l) => {
        // git rm takes an emptied folder with it.
        mkdirSync(join(root, 'scripts'), { recursive: true });
        for (const [name, body] of Object.entries(f)) writeFileSync(join(root, 'src', name), body);
        writeFileSync(join(root, 'scripts', 'check-ui-text.baseline.json'), JSON.stringify(l, null, 1) + '\n');
    };
    git('init', '-q');
    write(files, listed);
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('tag', 'base');
    return { top, root, git, write };
}

const check = (root, base) => {
    const run = spawnSync(process.execPath, [TOOL, '--root', root, '--base', base], { encoding: 'utf8' });
    return { code: run.status, out: run.stdout + run.stderr };
};

test('an entry added to the list since the base is found', () => {
    const r = repo({ 'a.html': '<p>Saved — done</p>' }, [DONE]);
    r.write({ 'a.html': '<p>Saved — done</p>', 'b.html': '<p>Mail -- Inbox</p>' }, [DONE, INBOX].sort());
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'branch');
    const { code, out } = check(r.root, 'base');
    assert.equal(code, 1, out);
    assert.match(out, /added to the grandfather list, which may only shrink: src\/b\.html: "Mail -- Inbox"/);
    rmSync(r.top, { recursive: true, force: true });
});

test("the base's list is read: the same list passes, and not as a list that begins here", () => {
    const r = repo({ 'a.html': '<p>Saved — done</p>' }, [DONE]);
    const { code, out } = check(r.root, 'base');
    assert.equal(code, 0, out);
    assert.match(out, /CLEAR/);
    assert.doesNotMatch(out, /the list begins here/);
    rmSync(r.top, { recursive: true, force: true });
});

test('a base with no list yet is where the list begins', () => {
    const r = repo({ 'a.html': '<p>Saved, done</p>' }, []);
    r.git('rm', '-q', 'angular/scripts/check-ui-text.baseline.json');
    r.git('commit', '-q', '-m', 'no list');
    r.git('tag', 'listless');
    r.write({}, []);
    r.git('add', '-A');
    r.git('commit', '-q', '-m', 'the list');
    const { code, out } = check(r.root, 'listless');
    assert.equal(code, 0, out);
    assert.match(out, /the list begins here: listless holds none/);
    rmSync(r.top, { recursive: true, force: true });
});

test('a base that is not a commit is UNEVALUABLE', () => {
    const r = repo({ 'a.html': '<p>Saved, done</p>' }, []);
    const { code, out } = check(r.root, 'no-such-ref');
    assert.equal(code, 2, out);
    assert.match(out, /UNEVALUABLE -- the base no-such-ref is not a commit here/);
    rmSync(r.top, { recursive: true, force: true });
});
