// The focus-indicator check on small sources, each FOUND case beside the form it allows.
// Run: node --test scripts/check-focus-indicators.test.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindingsMissing, check, focusRules, judge, translucentIn } from './check-focus-indicators.mjs';

const found = (css) => focusRules(css, 'case.ts').flatMap(judge).map((f) => `${f.kind} ${f.line}`);

const BOUND = `
:root,
.coolms-topbar {
    --bs-focus-ring-width: 2px;
    --bs-focus-ring-opacity: 1;
    --bs-focus-ring-color: var(--cms-focus-ring);
}
.btn {
    --bs-btn-focus-box-shadow: 0 0 0 2px var(--cms-focus-gap),
        0 0 0 calc(2px + var(--bs-focus-ring-width)) var(--bs-focus-ring-color);
}
.btn-close {
    --bs-btn-close-focus-shadow: 0 0 0 var(--bs-focus-ring-width) var(--bs-focus-ring-color);
}
html :is(.cms-input, .cms-field):focus {
    outline: 2px solid var(--cms-focus-ring);
    outline-offset: -1px;
}`;

test('the old translucent halo is found, at its line', () => {
    assert.deepEqual(found('.a { color: red; }\n.msg__search:focus-within { border-color: var(--cms-focus-ring); '
        + 'box-shadow: 0 0 0 2px rgba(37,99,235,.12); }'), ['HALO 2']);
});

test('every translucent spelling is a halo; the opaque ones are not', () => {
    for (const v of ['rgba(0,0,0,.5)', 'rgb(0 0 0 / 40%)', 'hsla(200, 50%, 50%, .2)', '#2563eb26', '#abc8',
        'color-mix(in srgb, var(--cms-accent) 70%, transparent)', 'var(--cms-info-subtle)',
        'rgba(var(--bs-danger-rgb), .25)']) {
        assert.notEqual(translucentIn(`0 0 0 2px ${v}`), null, v);
    }
    for (const v of ['rgb(0, 0, 0)', 'rgba(0,0,0,1)', '#2563ebff', '#2563eb', 'var(--cms-focus-ring)']) {
        assert.equal(translucentIn(`0 0 0 2px ${v}`), null, v);
    }
});

test('a ring in another colour is found; the ring, a surface gap and forced colours are not', () => {
    assert.deepEqual(found('.card:focus-visible { outline: 2px solid var(--cms-success); }'), ['OFF-TOKEN 1']);
    assert.deepEqual(found('.x:focus { box-shadow: 0 0 0 2px var(--cms-focus-ring), 0 0 0 4px #abc; }'),
        ['OFF-TOKEN 1']);
    assert.deepEqual(found('.x:focus-visible { outline: 2px solid var(--cms-focus-ring); outline-offset: 2px; }'), []);
    assert.deepEqual(found('.x:focus { box-shadow: 0 0 0 2px var(--cms-surface), 0 0 0 4px var(--cms-focus-ring); }'),
        []);
    assert.deepEqual(found('.x:focus { box-shadow: 0 0 0 2px var(--cms-focus-gap), 0 0 0 4px var(--cms-focus-ring); }'),
        []);
    assert.deepEqual(found('@media (forced-colors: active) { .btn:focus-visible { outline: 2px solid CanvasText; } }'),
        []);
});

test('an edge in another colour passes beside the ring, and is found without it', () => {
    assert.deepEqual(found('.c:focus { border-color: var(--cms-accent); box-shadow: 0 0 0 2px var(--cms-focus-ring); }'),
        []);
    assert.deepEqual(found('.s:focus { outline: none; border-color: var(--bs-primary, #0d6efd); }'), ['REMOVED 1', 'OFF-TOKEN 1']);
});

test('a component rule that takes the ring away is found in every spelling, whatever else it sets', () => {
    assert.deepEqual(found('.page-editor__title-input:focus { outline: none; }'), ['REMOVED 1']);
    assert.deepEqual(found('.rmd-textarea:focus { outline-style: none; }'), ['REMOVED 1']);
    assert.deepEqual(found('.x:focus { outline-style: hidden; }'), ['REMOVED 1']);
    assert.deepEqual(found('.x:focus { outline-width: 0; }'), ['REMOVED 1']);
    assert.deepEqual(found('.x:focus { outline: none; border-color: var(--cms-focus-ring); }'), ['REMOVED 1'],
        'an edge in the ring colour is not a ring');
    assert.deepEqual(found('.x:focus { outline: none; box-shadow: 0 0 0 1px var(--cms-focus-ring); }'), [],
        'a ring drawn as a shadow instead');
    assert.deepEqual(found('.x:focus-visible { outline-style: solid; outline-width: 2px; outline-color: var(--cms-focus-ring); }'),
        [], 'the ring in longhands');
});

test('a removal that names where the ring is drawn is waived, and every waiver is listed', () => {
    assert.deepEqual(found('.msg__search-input:focus { outline: none; /* ring: its .cms-field-box */ }'), []);
    const inStyles = focusRules('.i:focus { outline: none; box-shadow: none; }', 'styles.scss').flatMap(judge);
    assert.deepEqual(inStyles, [], 'the global stylesheet removes Bootstrap\'s own and draws the ring in the same rule set');
    const dir = mkdtempSync(join(tmpdir(), 'focus-check-'));
    try {
        writeFileSync(join(dir, 'styles.scss'), BOUND);
        writeFileSync(join(dir, 'search.component.ts'), 'const styles = [\x60\n.a { color: red; }\n'
            + '.s-input:focus { outline: none; /* ring: its .cms-field-box */ }\n\x60];\n');
        const r = check(dir);
        assert.deepEqual(r.found, []);
        assert.deepEqual(r.waived, [{ file: 'search.component.ts', line: 3, selector: '.s-input:focus', note: 'its .cms-field-box' }]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('removing an indicator is not drawing one; comments are not rules', () => {
    assert.deepEqual(found('.i:focus { outline: none; box-shadow: none; /* ring: elsewhere */ }'), []);
    assert.deepEqual(found('/* .x:focus { box-shadow: 0 0 0 2px rgba(0,0,0,.2); } */\n// .y:focus { outline: 1px solid red; }'),
        []);
});

test('nested SCSS: the rule is judged on its own declarations, not a child rule\'s', () => {
    assert.deepEqual(found('.f {\n    &:focus {\n        border-color: var(--cms-focus-ring);\n'
        + '        box-shadow: 0 0 0 1px var(--cms-focus-ring);\n    }\n}'), []);
    assert.deepEqual(found('.f {\n    &:focus {\n        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);\n    }\n}'),
        ['HALO 2']);
});

test('Bootstrap\'s focus variables: bound to the ring is clear, each one unbound is named', () => {
    assert.deepEqual(bindingsMissing(BOUND), []);
    assert.deepEqual(bindingsMissing(BOUND.replace('calc(2px + var(--bs-focus-ring-width)) var(--bs-focus-ring-color);\n}\n.btn-close',
        '.25rem rgba(13,110,253,.5);\n}\n.btn-close')), ['.btn: --bs-btn-focus-box-shadow is not the ring']);
    assert.deepEqual(bindingsMissing(''), [
        ':root: --bs-focus-ring-color is not var(--cms-focus-ring)',
        ':root: --bs-focus-ring-opacity is not 1',
        '.btn: --bs-btn-focus-box-shadow is not the ring',
        '.btn-close: --bs-btn-close-focus-shadow is not the ring',
        'the field rule (.cms-field:focus) does not draw `outline: 2px solid var(--cms-focus-ring)`',
    ]);
    assert.deepEqual(bindingsMissing(BOUND.replace('outline: 2px solid var(--cms-focus-ring);\n    outline-offset', 'outline: none;\n    outline-offset')),
        ['the field rule (.cms-field:focus) does not draw `outline: 2px solid var(--cms-focus-ring)`']);
});

test('the admin\'s own sources: rules read, none found, the bindings present', () => {
    const r = check(fileURLToPath(new URL('../src', import.meta.url)));
    assert.ok(r.files > 100, `read ${r.files} sources`);
    assert.ok(r.rules > 5, `read ${r.rules} focus rules`);
    assert.deepEqual(r.found, []);
    assert.deepEqual(r.bindings, []);
});

test('a directory with nothing to read is unevaluable, never clear', () => {
    const r = check('/nonexistent-focus-check-dir');
    assert.equal(r.files, 0);
    assert.equal(r.bindings, null);
});
