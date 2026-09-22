#!/usr/bin/env node
// Every `var(--cms-x, fallback)` is checked against what styles.scss defines.
//
// WHY. Three fallbacks reached `develop` inside two weeks and nothing in this
// package refused any of them: `--cms-accent-light` and `--cms-text-muted`,
// names nothing defines, each carrying a colour that then painted; and
// `var(--cms-accent, #2563eb)`, the right name with a BLUE beside an amber
// token. The backend's `make check-fe` caught the third, late, because it
// measures the clones' working trees from outside -- the backend commit gate
// builds a tree from the backend's own tracked files, and this package has
// none there (measured: `git ls-files '*.page.ts'` in that repository lists
// zero). The check has to live where the file is.
//
// WHAT FAILS. A `var(--cms-x, fallback)` under src/ where
//   * nothing defines `--cms-x`: not styles.scss, not a `setProperty('--cms-x')`,
//     not a `[style.--cms-x]` binding (a token a component SETS is defined,
//     just not in the stylesheet -- the dashboard writes `--cms-widget-span`
//     per card and reads it back with a fallback, which is correct); or
//   * `--cms-x` resolves, aliases followed, to ONE value and the fallback is
//     another: colours compared as r,g,b so `#FFF` and `#ffffff` agree, lengths
//     and keywords compared as text. `--cms-radius` is 6px; a site that says
//     `var(--cms-radius, 8px)` paints a different corner wherever the theme is
//     absent, and nothing else would ever say so.
//
// WHAT DOES NOT FAIL, and why:
//   * a fallback that is itself `var(...)` -- a chain; the theme decides;
//   * a token whose value has several parts (a font stack, a shadow list): an
//     abbreviated fallback such as `monospace` is legitimate there, and this
//     script does not claim to know which abbreviation is the right one;
//   * `var(--cms-x)` with no fallback -- check-undefined-tokens.mjs owns that;
//   * a fallback that AGREES with its token. Tolerated, not endorsed. MEASURED
//     when this was written: 1,218 fallback sites in 491 files; 27 disagreed
//     and were fixed in the same commit -- 11 lengths (`--cms-radius` 6px
//     written as 4px, 8px and 10px; `--cms-radius-sm` 4px written as 6px) and
//     16 colours written as `transparent`, `inherit` or an `rgba(...)` wash
//     under a solid token. The backend's check-cms-tokens.mjs had passed all
//     16, because its pattern excludes parentheses and compares only what it
//     can read as a colour: an instrument that skips what it cannot parse
//     reports OK on exactly the values it did not look at. After the fix:
//     1,100 equal, 20 chains, 96 abbreviated multi-part, 2 on the binding-set
//     token. Making 1,100 agreeing sites drop their fallback is a rewrite, not
//     a gate, so it is not this script's rule.
//
// WHERE IT RUNS. `npm run lint:fallbacks` on the working tree, and the local
// pre-push hook (release-tools/install-publish-hook.sh) on the tree of every
// commit being pushed: the commit's angular/src is checked out through a
// throwaway index into a temp dir (`git read-tree <sha>:angular/src` and
// `checkout-index --prefix`; not `git archive`, which honours the repo's
// `angular/ export-ignore` and yields zero files), then `--root <that dir>`.
// Subject and oracle come from the same tree, so a styles.scss edited but not
// committed cannot make a pushed fallback look right. The hook refuses when
// the pushed tree has a styles.scss and this script is missing: an absent
// instrument is not a pass.
//
// The fallback is read with balanced parentheses, not up to the first `)`.
// `var(--cms-accent, rgb(37,99,235))` is a fallback too; a pattern that stops
// at the first `)` compares `rgb(37,99,235`, cannot parse it, skips it, and the
// exact defect this exists for passes unread.
//
// THE SECOND CHECK, the selected family (Dmitry, 2026-09-22). `--cms-selected`
// has a wash (`-light`), the text on that wash (`-text`) and the foreground
// on the solid mark (`-fg`), so a theme that moves the mark moves its tints
// with it. Two things break that and both are refused here, per RULE, read
// as the block between `{` and `}` (a component's CSS lives in a template
// literal; the repository's no-backtick-inside rule makes those the odd
// segments of a split on backticks):
//   * a tint of `--cms-selected` mixed by hand -- `color-mix(... var(--cms-selected) ...)`
//     anywhere: the wash is `--cms-selected-light`; an overlay that must let
//     content through paints the mark and sets `opacity`;
//   * a selected fill whose text names another family: a block whose
//     background is `--cms-selected-light` and whose `color` is not
//     `--cms-selected-text`; a block whose background is `--cms-selected` and
//     whose `color` is not `--cms-selected-fg`; and the reverse, a
//     `--cms-selected-text` / `-fg` on a background that is not the matching
//     selected token. A block that declares no `color` inherits, which is
//     allowed. MEASURED when this was added: 23 blocks put text on the wash,
//     10 on the solid; all moved in the same commit.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const SRC = rootAt >= 0 && args[rootAt + 1]
    ? resolve(args[rootAt + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const THEME = join(SRC, 'styles.scss');

if (!existsSync(THEME)) {
    console.error(`✗ ${THEME} not found -- the check needs the theme's own definitions and will not guess them.`);
    process.exit(2);
}

/** A line that only TALKS about a token is neither a definition nor a use. */
const COMMENT = /^\s*(?:\*|\/\/|\/\*)/;
const NAME = /^--cms-[a-z0-9_-]+$/;

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* walk(path);
        else if (/\.(ts|scss|html)$/.test(entry)) yield path;
    }
}

function codeLines(path) {
    return readFileSync(path, 'utf8').split('\n').map((text, i) => ({ text, n: i + 1 }))
        .filter((l) => !COMMENT.test(l.text));
}

// -- the oracle: styles.scss, light block only (dark re-declares the same names)
const theme = readFileSync(THEME, 'utf8');
const darkAt = theme.indexOf("[data-theme='dark']");
const light = darkAt < 0 ? theme : theme.slice(0, darkAt);
const declared = new Map();
for (const line of light.split('\n')) {
    if (COMMENT.test(line)) continue;
    for (const [, name, value] of line.matchAll(/(--cms-[a-z0-9_-]+)\s*:\s*([^;\n]+);/g)) {
        declared.set(name, value.trim());
    }
}

function resolveToken(name, depth = 0) {
    const value = declared.get(name);
    if (undefined === value || depth > 4) return null;
    const alias = /^var\(\s*(--cms-[a-z0-9_-]+)\s*\)$/.exec(value);
    return alias ? resolveToken(alias[1], depth + 1) : value;
}

// -- runtime definitions: a token a component sets is defined
const runtimeDefined = new Set();
const files = [...walk(SRC)].filter((p) => p !== THEME);
for (const path of files) {
    for (const { text } of codeLines(path)) {
        for (const re of [/setProperty\(\s*['"`](--cms-[a-z0-9_-]+)['"`]/g, /style\.(--cms-[a-z0-9_-]+)/g]) {
            for (const [, name] of text.matchAll(re)) runtimeDefined.add(name);
        }
    }
}

/**
 * Every `var(...)` on a line, with balanced parentheses, split at the first
 * top-level comma into name and fallback. No comma: no fallback, not ours.
 */
function* varsWithFallback(text) {
    let from = 0;
    for (;;) {
        const at = text.indexOf('var(', from);
        if (at < 0) return;
        let depth = 0;
        let comma = -1;
        let end = -1;
        for (let i = at + 3; i < text.length; i++) {
            const c = text[i];
            if ('(' === c) depth++;
            else if (')' === c) {
                depth--;
                if (0 === depth) { end = i; break; }
            } else if (',' === c && 1 === depth && comma < 0) comma = i;
        }
        if (end < 0) return;
        from = end + 1;
        if (comma < 0) continue;
        const name = text.slice(at + 4, comma).trim();
        if (!NAME.test(name)) continue;
        yield { name, fallback: text.slice(comma + 1, end).trim() };
    }
}

/** Top-level parts of a value: `0 8px rgba(0,0,0,.1)` is three, `rgba(0,0,0,.1)` is one. */
function parts(value) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const c of value) {
        if ('(' === c) depth++;
        if (')' === c) depth--;
        if (0 === depth && /[\s,]/.test(c)) {
            if (cur) out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur) out.push(cur);
    return out;
}

/** A colour as `r,g,b[,a]`, so #FFF, #ffffff and rgb(255,255,255) compare equal; else the text itself. */
function canonical(raw) {
    const text = raw.trim().toLowerCase();
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
    if (hex) {
        const d = hex[1];
        const pairs = d.length <= 4
            ? [...d].map((ch) => ch + ch)
            : d.match(/../g);
        const nums = pairs.map((p) => parseInt(p, 16));
        if (4 === nums.length) nums[3] = Math.round((nums[3] / 255) * 100) / 100;
        return nums.join(',');
    }
    const fn = /^rgba?\((.*)\)$/.exec(text);
    if (fn) {
        const nums = fn[1].split(/[\s,/]+/).filter(Boolean);
        if (nums.length >= 3 && nums.slice(0, 3).every((p) => /^\d+$/.test(p))) {
            const out = nums.slice(0, 3);
            if (nums[3] !== undefined && '1' !== nums[3]) out.push(String(Number(nums[3])));
            return out.join(',');
        }
    }
    return text.replace(/\s+/g, ' ');
}

const findings = [];
let sites = 0;
let agree = 0;
let chained = 0;
let abbreviated = 0;
let onRuntime = 0;

for (const path of files) {
    for (const { text, n } of codeLines(path)) {
        for (const { name, fallback } of varsWithFallback(text)) {
            sites++;
            const where = `${relative(SRC, path)}:${n}`;
            const value = resolveToken(name);
            if (null === value) {
                if (runtimeDefined.has(name)) { onRuntime++; continue; }
                findings.push(`${where}  var(${name}, ${fallback}) -- nothing defines ${name}`);
                continue;
            }
            if (/^var\(/.test(fallback)) { chained++; continue; }
            if (parts(value).length !== 1) { abbreviated++; continue; }
            if (canonical(value) === canonical(fallback)) { agree++; continue; }
            findings.push(`${where}  var(${name}, ${fallback}) -- the token is ${value}`);
        }
    }
}

if (findings.length > 0) {
    console.error(`✗ ${findings.length} var() fallback(s) disagree with styles.scss (${sites} checked in ${files.length} files):`);
    for (const f of findings) console.error(`  ${f}`);
    console.error('  A fallback paints wherever the theme is absent. Make it the token\'s own value,');
    console.error('  or define the token in styles.scss if it is new.');
    process.exit(1);
}

console.log(
    `✓ ${sites} var(--cms-*, fallback) sites in ${files.length} files agree with styles.scss`
    + ` (${declared.size} tokens): ${agree} equal, ${chained} chain to another var(),`
    + ` ${abbreviated} abbreviate a multi-part token, ${onRuntime} rest on a token a component sets.`,
);

// -- the selected family: no hand-mixed tint, and a selected fill carries selected text
function* cssLines(path) {
    const text = readFileSync(path, 'utf8');
    if (!path.endsWith('.ts')) { yield* text.split('\n'); return; }
    const out = text.split('\n').map(() => '');
    let offset = 0;
    text.split('`').forEach((part, k) => {
        const start = text.slice(0, offset).split('\n').length - 1;
        if (k % 2 === 1 && /\{[^}]*:[^}]*;/.test(part)) {
            part.split('\n').forEach((l, j) => { out[start + j] = (out[start + j] ?? '') + l; });
        }
        offset += part.length + 1;
    });
    yield* out;
}

/** The rules of one file: { line, selector, decls }, nested SCSS followed through its stack. */
function cssRules(path) {
    const rules = [];
    const stack = [];
    const read = (frame, body) => {
        for (const part of body.split(';')) {
            const m = (part.trim() + ';').match(/^\s*([a-z-]+)\s*:\s*([^;]+);/);
            if (m) frame.decls[m[1]] = m[2].trim();
        }
    };
    let n = 0;
    for (const raw of cssLines(path)) {
        n++;
        if (COMMENT.test(raw)) continue;
        let text = raw.trim();
        while (text.length) {
            const open = text.indexOf('{');
            const close = text.indexOf('}');
            if (open >= 0 && (close < 0 || open < close)) {
                const sel = text.slice(0, open).trim();
                stack.push({ sel: /^[a-z-]+\s*:/.test(sel) && !/^&/.test(sel) ? '' : sel, line: n, decls: {} });
                text = text.slice(open + 1).trim();
                continue;
            }
            if (close >= 0) {
                if (stack.length) read(stack[stack.length - 1], text.slice(0, close));
                const done = stack.pop();
                if (done && Object.keys(done.decls).length) {
                    rules.push({ line: done.line, selector: [...stack.map((s) => s.sel), done.sel].filter(Boolean).join(' '), decls: done.decls });
                }
                text = text.slice(close + 1).trim();
                continue;
            }
            if (stack.length) read(stack[stack.length - 1], text);
            text = '';
        }
    }
    return rules;
}

const family = [];
let blocksOnWash = 0;
let blocksOnSolid = 0;
const names = (v) => v?.match(/--cms-selected(?:-[a-z]+)?\b/g) ?? [];
for (const path of [...files, THEME]) {
    const where = (n) => `${relative(SRC, path)}:${n}`;
    for (const { text, n } of codeLines(path)) {
        if (/color-mix\([^)]*--cms-selected/.test(text)) {
            family.push(`${where(n)}  a tint of --cms-selected mixed by hand -- the wash is --cms-selected-light; an overlay paints the mark and sets opacity`);
        }
    }
    for (const rule of cssRules(path)) {
        const fill = rule.decls['background'] ?? rule.decls['background-color'];
        const fillNames = names(fill);
        const textNames = names(rule.decls['color']);
        const onWash = fillNames.includes('--cms-selected-light');
        const onSolid = fillNames.includes('--cms-selected') && !onWash;
        if (onWash) blocksOnWash++;
        if (onSolid) blocksOnSolid++;
        if (rule.decls['color'] !== undefined) {
            if (onWash && !textNames.includes('--cms-selected-text')) {
                family.push(`${where(rule.line)}  ${rule.selector}: text on --cms-selected-light is [${rule.decls['color']}], not --cms-selected-text`);
            }
            if (onSolid && !textNames.includes('--cms-selected-fg')) {
                family.push(`${where(rule.line)}  ${rule.selector}: text on --cms-selected is [${rule.decls['color']}], not --cms-selected-fg`);
            }
        }
        if (fill !== undefined) {
            if (textNames.includes('--cms-selected-text') && !onWash) {
                family.push(`${where(rule.line)}  ${rule.selector}: --cms-selected-text sits on [${fill}], not --cms-selected-light`);
            }
            if (textNames.includes('--cms-selected-fg') && !onSolid) {
                family.push(`${where(rule.line)}  ${rule.selector}: --cms-selected-fg sits on [${fill}], not --cms-selected`);
            }
        }
    }
}

if (family.length > 0) {
    console.error(`✗ ${family.length} rule(s) break the selected family:`);
    for (const f of family) console.error(`  ${f}`);
    console.error('  A selected fill carries selected text (-text on -light, -fg on the mark), and a tint');
    console.error('  of the mark is --cms-selected-light, never color-mix by hand -- so a theme that moves');
    console.error('  --cms-selected moves its tints with it.');
    process.exit(1);
}

console.log(`✓ the selected family holds: ${blocksOnWash} block(s) on --cms-selected-light, ${blocksOnSolid} on --cms-selected, no hand-mixed tint.`);
