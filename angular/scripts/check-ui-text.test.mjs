// The UI-text dash check on small templates: what a person sees is read, code and CSS are not; each rule's case.
// Run: node --test scripts/check-ui-text.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { breaks, visibleStrings } from './check-ui-text.mjs';

const texts = (tpl) => visibleStrings(tpl).map((s) => s.text);

test('an em dash, "--" and a spaced hyphen break the rule', () => {
    assert.deepEqual(breaks('Upload CSV — Coming soon.'), ['an em dash']);
    assert.deepEqual(breaks('no user references -- only Single mode'), ['"--"']);
    assert.deepEqual(breaks('Germany - Berlin'), ['a spaced hyphen']);
    assert.deepEqual(breaks('- None'), ['a spaced hyphen']);
    assert.deepEqual(breaks('Thumbnails -'), ['a spaced hyphen']);
});

test('an en dash passes only between two values with no spaces', () => {
    assert.deepEqual(breaks('Open Mon–Fri, 9–17'), []);
    assert.deepEqual(breaks('9 – 17'), ['an en dash not between two values']);
    assert.deepEqual(breaks('– none'), ['an en dash not between two values']);
});

test('two sentences, a comma, a colon and a hyphenated word pass', () => {
    assert.deepEqual(breaks('Available when the template uses a person\'s details. Pick one.'), []);
    assert.deepEqual(breaks('Read-only: a well-known name, re-sent'), []);
});

test('reads the text between tags and the attributes a person reads', () => {
    const tpl = '<p title="A — title">Hello -- world</p><input placeholder="Search - all" actionLabel="Retry" />';
    assert.deepEqual(texts(tpl).sort(), ['A — title', 'Hello -- world', 'Retry', 'Search - all'].sort());
});

test('never reads CSS, bindings, interpolations, blocks or comments', () => {
    const tpl = [
        '<style>.a { margin: var(--cms-space-4); }</style>',
        '<!-- a note -- for the author -->',
        '<div [class.mbx__dot--active]="n > 0 && n - 1 === step()" [title]="a -- b">',
        '  {{ count - 1 }}',
        '  @if (n > 0 -- 1) {',
        '  }',
        '</div>',
    ].join('\n');
    assert.deepEqual(texts(tpl).filter((t) => breaks(t).length), []);
});

test('a single-quoted attribute a person reads is read too', () => {
    assert.deepEqual(texts("<button title='Save — close' aria-label='Close'>Go</button>").sort(), ['Close', 'Go', 'Save — close']);
});

test('an attribute value holding > does not end its tag early', () => {
    const tpl = '<cms-x [prev]="i > 0 ? items[i - 1] : null" label="Fine">Words</cms-x>';
    assert.deepEqual(texts(tpl).sort(), ['Fine', 'Words']);
});
