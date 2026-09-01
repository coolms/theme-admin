#!/usr/bin/env node
// Guard against `var(--cms-*)` referencing a token that does not exist.
//
// This class has now bitten four times: --cms-primary and --cms-surface-muted
//, --cms-canvas, and 44 more. It is worth a permanent
// check because it is INVISIBLE in review — CSS does not warn, the build does
// not fail, and the page usually looks almost right.
//
// TWO severities, because the consequences differ sharply:
//
//   HARD FAIL — a reference with NO fallback. `var(--nope)` alone makes the
//   declaration invalid at computed-value time, so the property RESETS rather
//   than degrading: measured in the browser, `background` became transparent
//   (a hover state that never appears) and `border-color` became currentColor
//   (a border drawn in the TEXT colour). These are always defects, so there is
//   no baseline to grow into — any occurrence fails.
//
//   RATCHET — a reference WITH a fallback still renders, but each call site
//   carries its own value and they drift apart (27 references to
//   --cms-font-mono once carried three different font stacks). Tolerated at a
//   baseline that may only shrink.
//
// Scans .ts, .scss AND .html: the image editor is styled in .scss, and a
// .ts-only sweep wrongly reported --cms-canvas-bg as dead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Referenced-but-undefined tokens that still carry a fallback. LOWER ONLY. */
// 28 -> 27: --cms-primary-soft went with a deleted kit shadow.
// 27 -> 26: --cms-input-bg was referenced by two components and defined
//                  by nobody; dark mode forced it to be named for real.
// 26 -> 25: another name that existed only as a fallback got defined.
const WITH_FALLBACK_BASELINE = 25;

const defined = new Set();
for (const [, name] of readFileSync(join(SRC, 'styles.scss'), 'utf8')
    .matchAll(/^\s*(--cms-[a-z0-9-]+)\s*:/gm)) {
    defined.add(name);
}

/**
 * Tokens a component SETS at runtime are defined — just not in the stylesheet.
 *
 * The editor writes `--cms-page-width` / `--cms-page-height` per page geometry
 * and removes them when it goes away, deliberately: they are scoped state, not
 * palette. Flagging those would be a false failure, and a guard that cries wolf
 * is a guard someone switches off — so a `setProperty('--cms-x', …)` anywhere in
 * `src` counts as a definition.
 */
function collectRuntimeDefined() {
    const set = new Set();
    for (const file of walk(SRC)) {
        for (const [, name] of readFileSync(file, 'utf8')
            .matchAll(/setProperty\(\s*['"`](--cms-[a-z0-9-]+)['"`]/g)) {
            set.add(name);
        }
    }

    return set;
}

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* walk(path);
        else if (/\.(ts|scss|html)$/.test(entry)) yield path;
    }
}

// Capture the name and whether a comma (hence a fallback) follows it.
const REF = /var\(\s*(--cms-[a-z0-9-]+)\s*(,?)/g;

const runtimeDefined = collectRuntimeDefined();
const noFallback = new Map();
const withFallback = new Set();

for (const file of walk(SRC)) {
    if (file.endsWith('styles.scss')) continue;
    const text = readFileSync(file, 'utf8');
    for (const [, name, comma] of text.matchAll(REF)) {
        if (defined.has(name) || runtimeDefined.has(name)) continue;
        if (comma) {
            withFallback.add(name);
        } else {
            const key = `${name}  ${relative(ROOT, file)}`;
            noFallback.set(key, (noFallback.get(key) ?? 0) + 1);
        }
    }
}

let failed = false;

if (noFallback.size > 0) {
    failed = true;
    const total = [...noFallback.values()].reduce((a, b) => a + b, 0);
    console.error(`\n✗ ${total} reference(s) to an UNDEFINED token with NO fallback.\n`);
    console.error('  These do not degrade — the declaration is dropped. A background');
    console.error('  becomes transparent; a border-color becomes currentColor.');
    console.error('  Define the token in styles.scss (an alias to the canonical one is');
    console.error('  usually right), or give the reference a fallback.\n');
    for (const [key, n] of [...noFallback].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.error(`    ${String(n).padStart(3)}  ${key}`);
    }
    console.error('');
}

if (withFallback.size > WITH_FALLBACK_BASELINE) {
    failed = true;
    console.error(`✗ Undefined tokens (with fallback): ${withFallback.size} (baseline ${WITH_FALLBACK_BASELINE}).`);
    console.error('  Each call site carries its own fallback, so they drift. Define the token.\n');
} else if (withFallback.size < WITH_FALLBACK_BASELINE) {
    console.log(`✓ Undefined tokens (with fallback): ${withFallback.size} — down ${WITH_FALLBACK_BASELINE - withFallback.size}. Lower the baseline to lock it in.`);
} else {
    console.log(`✓ Undefined tokens (with fallback): ${withFallback.size}, unchanged.`);
}

if (!failed) console.log('✓ No undefined-token references without a fallback.');

process.exit(failed ? 1 : 0);
