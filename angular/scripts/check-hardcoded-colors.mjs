#!/usr/bin/env node
// Ratchet on hard-coded colours in the admin SPA.
//
// The admin is themed through `--cms-*` custom properties, which is what lets a
// system setting or a per-user preference re-colour it at runtime (#2013 proved
// that end to end: overriding the tokens on `:root` re-themes the running app).
// A colour written as a literal escapes that entirely — it keeps its value when
// the theme changes, so a themed admin comes out half-themed.
//
// This does NOT try to fix the existing stock. It fixes the FLOW: the count may
// never go up. Every literal replaced by the token that MEANS it lowers the
// number, and the baseline is lowered with it.
//
// Run: npm run lint:colors
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/**
 * The number of bare colour literals at the last ratchet.
 *
 * LOWER THIS when you remove some. Never raise it: if this check fails, the
 * change added hard-coded colour, and the fix is to use the token that carries
 * the MEANING you want — not the one that happens to hold the same value. Those
 * differ: `#9ca3af` is both `--cms-text-muted` and `--cms-btn-hover-border`, and
 * picking by value couples muted text to button borders (#2013).
 */
// History worth keeping, because one of these drops was NOT progress:
//   634 → 290  real removals (#2014–#2025)
//   290 → 273  a COUNTING fix (#2026), no literals removed — the gap pattern
//              had been double-counting inside JS object literals
//   273 → 247  real removals (#2027, the near-white grey consolidation)
//   247 → 219  real removals (#2028, the text-body and danger-text tail)
//   219 → 218  a literal that lived inside a DEAD rule (#2029)
//   218 → 213  literals inside components that were re-declaring the KIT's own
//              classes (#2030) — deleting the shadow deleted the literal
//   213 → 211  literals dark mode EXPOSED (#2031) — a media tile and its thumb
//              that stayed light while everything around them flipped. Dark
//              mode is the sharpest ratchet there is: it does not count
//              literals, it shows you the ones that MATTER.
//   211 → 211  UNCHANGED but no longer the same measurement (#2032): the scan
//              now covers styles.scss outside its :root blocks, which exposed
//              10 literals in the kit's own component rules. All 10 were
//              removed in the same pass, so the number held while the scope
//              widened. Do not read this as "nothing happened".
//   211 → 210  the document editor's desk grey, found by opening an actual
//              document in dark mode (#2036). The literal was never the
//              defect — the THEMED token next to it was.
//   210 → 205  the tag input, still wholly on Bootstrap's palette down to a
//              BLUE focus ring, found by opening the email composer (#2038)
//   205 → 204  the image-map editor's active-tool border, found by opening the
//              regions editor in dark mode (#2042)
//   204 → 193  status-tinted chip PAIRS mapped to the family that means the
//              same thing (#2043). Only where value AND meaning agreed —
//              `--dynamic` / `--key` share the amber value but label a KIND,
//              not a state, so they stay literal rather than be filed under
//              warning for looking like it.
const BASELINE = 193;

/**
 * References to BOOTSTRAP colour class names — a second, independent way for a
 * colour to escape the kit, and one the hex count above cannot see.
 *
 * Found by re-theming the running admin and noticing the datagrid's Yes badge
 * did not follow: it is `class="badge bg-success"`, which contains no literal
 * yet pins the element to BOOTSTRAP's palette (#198754) (#2018).
 *
 * Two shapes, both counted, because both mean "this colour does not come from
 * the kit" — but they are FIXED DIFFERENTLY, so read the offender before acting:
 *
 *  - **Template usage**: `class="badge bg-success"`, `alert alert-danger`,
 *    `text-muted`. Fix by using the kit class (`.cms-badge--success`).
 *  - **Local re-definition**: a component styling `.btn-primary { … }` in its
 *    own scoped block, shadowing Bootstrap's name with a private copy. That is
 *    the same fault as the toggle trapped in the datagrid (#2011) — a kit
 *    control re-implemented per component. Fix by using `.cms-btn
 *    cms-btn-primary` in the markup and deleting the local rule.
 *
 * Counted separately from the hex total so it is visible WHICH debt moved.
 */
// 238 → 198 (#2029): forty of these were never template usages at all but DEAD
// `.btn-primary` / `.btn-danger` SELECTORS — components re-styling Bootstrap's
// names in scoped CSS whose markup had already migrated to `.cms-btn`. Deleting
// the dead rules removed them. That is why #2019 insisted the two shapes be
// read before being acted on: a third of this count was not what it looked like.
// 198 → 188 (#2030): the last eleven `btn btn-primary` / `btn-outline-secondary`
// call sites moved to the kit, including the LOGIN button — the first screen in
// the product, and it was rendering Bootstrap blue against an amber brand.
// 188 → 187: excluding `placeholder` values, which are prose about classes.
const BOOTSTRAP_BASELINE = 187;

/**
 * Bootstrap colour classes that are DELIBERATELY still in the markup because a
 * bridge rule re-points them at `--cms-*` tokens (#2020, completed in #2030).
 *
 * The count above cannot express the thing that actually matters. It treats a
 * bridged `.text-muted` and an unbridged `.text-white` as one unit of debt, so
 * "198 references" read as a single backlog when it was two: 155 already
 * themeable and 43 not themed at all. Nothing in the tooling said which — the
 * gap was found by re-theming the LIVE app and watching what failed to move.
 *
 * So the number stays a ratchet, and the real rule becomes an INVARIANT: every
 * Bootstrap colour class used in markup must be bridged in styles.scss. Adding
 * `class="badge bg-dark"` tomorrow fails this immediately, instead of quietly
 * adding one to a count nobody reads as "and that one is unthemeable".
 *
 * Most bridges are class-side (`.bg-success { background-color: … }`) and are
 * DISCOVERED in styles.scss rather than listed here. This map is only for the
 * ones bridged through a Bootstrap variable, where no selector names the class
 * and no scan could infer the link.
 */
const BRIDGED_VIA_BS_VARIABLE = {
    // `.text-muted` reads --bs-secondary-color, which :root re-points. 105 sites
    // ride on this one line, which is why #2020 preferred it to a migration.
    'text-muted': '--bs-secondary-color',
    'text-body': '--bs-body-color',
    'border-primary': '--bs-border-color',
    'border-secondary': '--bs-border-color',
};

// Only a hex inside a colour DECLARATION counts. A bare `#[0-9a-f]{3,8}` matches
// `#1709` — a ledger reference — and this codebase's comments are full of them;
// counting those produced a "worst offenders" list of task IDs.
//
// KNOWN GAP, stated rather than hidden: `rgb()` / `rgba()` literals are NOT
// counted, so `rgba(220,38,38,.1)` — which is `--cms-danger` at 10% — slips
// through. They are a real form of the same problem and the harder one to fix,
// because an alpha variant usually has no token at all; `color-mix()` or an
// explicit `--cms-danger-subtle` is the answer, and that is a palette decision.
// Counting them today would make the ratchet unfixable rather than useful.
const PROPS = [
    'color', 'background', 'background-color',
    'border', 'border-color', 'border-top', 'border-bottom', 'border-left', 'border-right',
    'fill', 'stroke', 'box-shadow', 'outline', 'caret-color',
].join('|');
// `[^;{}\n]` — the NEWLINE exclusion is load-bearing, and was added after the
// same omission broke a codemod (#2025). A CSS declaration ends at a semicolon,
// so `[^;{}]*` is right for CSS — but these files also contain JavaScript object
// literals, which end at COMMAS. There, the gap runs on across lines, picks up
// hexes belonging to LATER properties, and counts them again when those
// properties match in their own turn. That inflated this count by 17.
const DECLARATION = new RegExp(`(?:${PROPS})\\s*:([^;{}\\n]*)`, 'g');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function* walk(dir, exts = ['.ts', '.scss']) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* walk(path, exts);
        else if (exts.some(e => entry.endsWith(e))) yield path;
    }
}

// The negative lookbehinds are load-bearing: without them `btn-primary` matches
// inside `cms-btn-primary` and `text-secondary` inside `--cms-text-secondary`,
// which counts the KIT's own names as Bootstrap debt. A first run reported 1216
// that way; the true figure is 238.
const BOOTSTRAP_UTILS = /(?<!-)(?<!cms-)\b(bg|text|border|btn|btn-outline|alert|badge|table|link)-(primary|secondary|success|danger|warning|info|light|dark|muted|body|white|black)\b/g;

/**
 * Blank out the token-DEFINITION blocks of styles.scss, keeping the rest.
 *
 * The whole file used to be skipped, on the reasoning that literals are the
 * point where tokens are defined. True for the `:root` blocks and false for
 * everything below them — styles.scss also holds the kit's component rules, and
 * three literals hid there for the entire arc, including `.form-group label`
 * at the value of --cms-text-body. Dark mode found that one at 1.53:1 in a
 * dialog because no counter was ever looking (#2032).
 *
 * Lines are replaced rather than removed so reported line numbers stay true.
 */
function maskTokenBlocks(text) {
    const lines = text.split('\n');
    let depth = 0, inRoot = false;
    return lines.map(line => {
        // `:root {` and `:root[data-theme='dark'] {` open a definition block.
        if (!inRoot && /^\s*:root[^{]*\{/.test(line)) { inRoot = true; depth = 0; }
        if (!inRoot) return line;
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        const masked = '';
        if (depth <= 0) inRoot = false;

        return masked;
    }).join('\n');
}

const offenders = new Map();
let total = 0;

for (const file of walk(SRC)) {
    const raw = readFileSync(file, 'utf8');
    const text = file.endsWith('styles.scss') ? maskTokenBlocks(raw) : raw;

    for (const [, value] of text.matchAll(DECLARATION)) {
        for (const hex of value.match(HEX) ?? []) {
            // A literal inside `var(--token, #fallback)` is NOT hard-coding: the
            // token is being used, and the literal is a deliberate safety net for
            // when it is undefined. Rewriting those was the mistake #2013 caught.
            const before = value.slice(0, value.indexOf(hex));
            if (/var\([^()]*$/.test(before)) continue;

            total++;
            const key = relative(ROOT, file);
            offenders.set(key, (offenders.get(key) ?? 0) + 1);
        }
    }
}

// Second count: Bootstrap colour utilities, over templates (.ts and .html).
let bootstrap = 0;
const bootstrapOffenders = new Map();
const bootstrapUsed = new Map();
for (const file of walk(SRC, ['.ts', '.html'])) {
    let text = readFileSync(file, 'utf8');

    // `placeholder="btn btn-primary"` is EXAMPLE TEXT in the link editor's
    // "CSS classes" input — the user really does type Bootstrap class names
    // there. It is prose about classes, not a class, so it is not debt and
    // cannot be migrated. Dropping placeholder values keeps the invariant
    // below from demanding a bridge for a string nothing ever renders.
    text = text.replace(/placeholder\s*=\s*"[^"]*"/g, '');

    for (const [cls] of text.matchAll(BOOTSTRAP_UTILS)) {
        bootstrap++;
        const key = relative(ROOT, file);
        bootstrapOffenders.set(key, (bootstrapOffenders.get(key) ?? 0) + 1);
        if (!bootstrapUsed.has(cls)) bootstrapUsed.set(cls, new Set());
        bootstrapUsed.get(cls).add(key);
    }
}

// Which of those classes styles.scss actually re-points. Class-side bridges are
// discovered (a rule whose selector IS the Bootstrap class); variable-side ones
// come from the map above, because no selector mentions the class at all.
const kit = readFileSync(join(SRC, 'styles.scss'), 'utf8');
const bridged = new Set(Object.keys(BRIDGED_VIA_BS_VARIABLE));
for (const [, cls] of kit.matchAll(/^\s*\.([a-z-]+)\s*(?:,|\{)/gm)) bridged.add(cls);
// A selector list writes later classes on their own lines too; catch `.a,\n.b {`.
for (const [, cls] of kit.matchAll(/[,{]\s*\n\s*\.([a-z-]+)\s*[,{]/g)) bridged.add(cls);

const unbridged = [...bootstrapUsed.keys()].filter(c => !bridged.has(c)).sort();

let failed = false;

function report(label, count, baseline, list, advice) {
    if (count > baseline) {
        failed = true;
        console.error(`\n✗ ${label}: ${count} (baseline ${baseline}) — ${count - baseline} added.\n`);
        console.error(`  ${advice}\n`);
        console.error('  Most by file:');
        for (const [file, n] of [...list].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
            console.error(`    ${String(n).padStart(4)}  ${file}`);
        }
        console.error('');

        return;
    }
    if (count < baseline) {
        console.log(`✓ ${label}: ${count} — down ${baseline - count}. Lower its baseline to ${count} to lock it in.`);

        return;
    }
    console.log(`✓ ${label}: ${count}, unchanged.`);
}

report(
    'Hard-coded colour literals', total, BASELINE, offenders,
    'Use the token that MEANS what you want, e.g. var(--cms-text-secondary), not the one that shares the value.',
);
report(
    'Bootstrap colour class references', bootstrap, BOOTSTRAP_BASELINE, bootstrapOffenders,
    'Neither a Bootstrap utility nor a locally re-styled .btn-primary can follow a CoolMS theme. Use the kit: .cms-badge--success for bg-success, .cms-btn cms-btn-primary instead of restyling .btn-primary.',
);

// The invariant. Not a ratchet: an unbridged class is unthemeable, full stop.
if (unbridged.length) {
    failed = true;
    console.error(`\n✗ Bootstrap colour classes with NO bridge: ${unbridged.length}.\n`);
    console.error('  These read Bootstrap\'s palette and cannot follow a CoolMS theme. Either');
    console.error('  bridge them in the styles.scss bridge block, or use the kit class instead.\n');
    for (const cls of unbridged) {
        const files = [...bootstrapUsed.get(cls)];
        console.error(`    ${cls}  (${files.length} file${files.length === 1 ? '' : 's'}) e.g. ${files[0]}`);
    }
    console.error('');
} else {
    console.log(`✓ Every Bootstrap colour class in use (${bootstrapUsed.size} distinct) is bridged to a --cms-* token.`);
}

process.exit(failed ? 1 : 0);
