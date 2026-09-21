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
// none there (backend ledger #3041). The check has to live where the file is.
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
// commit being pushed: `git archive <sha> angular/src` into a temp dir, then
// `--root <that dir>/angular/src`. Subject and oracle come from the same tree,
// so a styles.scss edited but not committed cannot make a pushed fallback look
// right. The hook refuses when the pushed tree has a styles.scss and this
// script is missing: an absent instrument is not a pass.
//
// The fallback is read with balanced parentheses, not up to the first `)`.
// `var(--cms-accent, rgb(37,99,235))` is a fallback too; a pattern that stops
// at the first `)` compares `rgb(37,99,235`, cannot parse it, skips it, and the
// exact defect this exists for passes unread.
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
