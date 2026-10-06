#!/usr/bin/env node
// Every focus indicator under src/ draws the ring: --cms-focus-ring, opaque.
//
// WHY. Dmitry, 2026-10-06, from the review of theme-admin#69: the ring was set in
// a :where() rule at zero specificity, and two kinds of focus outlived it. Bootstrap
// draws its own -- `outline: 0` and a translucent blue shadow from its variables --
// at more specificity, so ten Bootstrap buttons kept it; and five component fields
// moved their edge to the ring but kept the old translucent halo beside it. Both are
// now fixed at the root: Bootstrap's focus variables are bound once to the token in
// styles.scss, and one rule there gives every field its focus. This check keeps it so.
//
// WHAT FAILS (FOUND), in any :focus, :focus-visible or :focus-within rule:
//   * a HALO: an outline, box-shadow or border colour that is translucent -- an
//     rgba()/hsla() or slash alpha under 1, an 8- or 4-digit hex under ff, a
//     color-mix() with `transparent`, a `-subtle`/`-soft` token, or Bootstrap's
//     `--bs-*-rgb` built into one;
//   * an OFF-TOKEN ring: an outline or box-shadow that draws (is not none or 0) in
//     no colour but one other than the ring. A box-shadow may lay the ring over a
//     --cms-focus-gap (or --cms-surface) band; forced colours may use the system's;
//     a border colour of another token is the control's own edge only when the same
//     rule draws the ring beside it.
//   * a REMOVED ring: a component's focus rule (anywhere but styles.scss) that takes
//     the outline or the box-shadow away -- `outline: none`, `outline-style: none` or
//     `hidden`, `outline-width: 0`, `box-shadow: none` -- and draws no outline or
//     box-shadow ring instead, whatever else it sets (an edge colour is not a ring). A
//     component rule outranks the global field rule, so on a field it leaves no
//     indicator. WAIVED when the rule says where the ring is drawn instead, in a
//     comment in the rule: `/* ring: <where> */` (an input inside a `cms-field-box`).
//     Every waiver is listed, with its file, line and note, and counted.
// And in styles.scss: Bootstrap's focus variables not bound to the ring
// (--bs-focus-ring-color on :root, --bs-btn-focus-box-shadow on .btn,
// --bs-btn-close-focus-shadow on .btn-close), and the field rule (the one naming
// `.cms-field`) not drawing the ring as an outline.
//
// WHAT IT CANNOT SEE: a rule Bootstrap or a package stylesheet ships. The rendered
// half is src/app/shell/focus-ring.spec.ts, which focuses Bootstrap's controls in a
// browser with the real stylesheets and measures what each draws, and its contrast.
//
// Exit: 0 CLEAR, 1 FOUND, 2 UNEVALUABLE (no source read, or no focus rule found).
// Run: node scripts/check-focus-indicators.mjs [src-dir]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RING = /var\(\s*--(cms-focus-ring|bs-focus-ring-color)\b/;
const SYSTEM = /\b(CanvasText|Highlight|ButtonText|LinkText)\b/;
const GAP = /var\(\s*--cms-(surface|focus-gap)\s*\)/g;
const DRAWS = /(?:^|[;{\s])(outline(?:-color|-style|-width)?|box-shadow|border(?:-color)?)\s*:\s*([^;{}]+)/g;
const REMOVES = /^\s*(none|hidden|0|0px|transparent)\s*(!important)?\s*$/;
/** The properties a focus ring is drawn with: the outline, its longhands, and the box-shadow. */
const RING_PROP = (prop) => prop.startsWith('outline') || prop === 'box-shadow';
/** Longhands that carry no colour: judged only as removals. */
const NO_COLOUR = new Set(['outline-style', 'outline-width']);

/** The translucent colour in a value, or null. */
export function translucentIn(value) {
    const fn = value.match(/\b(rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    for (const f of fn) {
        const args = f.slice(f.indexOf('(') + 1, -1);
        const parts = args.includes('/') ? args.split('/') : args.split(',');
        // an alpha: after a slash, the fourth of four, or the second after one var() holding r,g,b
        const alphaPart = args.includes('/') || parts.length === 4
            || (parts.length === 2 && /^\s*var\(/.test(parts[0]));
        const last = alphaPart ? parts[parts.length - 1].trim() : null;
        if (last !== null) {
            const a = last.endsWith('%') ? parseFloat(last) / 100 : parseFloat(last);
            if (!Number.isNaN(a) && a < 1) return f;
        }
        if (/var\(--bs-[a-z-]*-rgb\)/.test(f)) return f;
    }
    for (const h of value.match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{4}\b/g) ?? []) {
        const alpha = h.length === 9 ? h.slice(7) : h.slice(4).repeat(2);
        if (alpha.toLowerCase() !== 'ff') return h;
    }
    const mix = value.match(/color-mix\((?:[^()]|\([^()]*\))*\)/);
    if (mix && /\btransparent\b/.test(mix[0])) return mix[0];
    const soft = value.match(/var\(\s*--[a-z0-9-]*-(subtle|soft)\b[^)]*\)/);
    if (soft) return soft[0];
    return null;
}

const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

/** Every focus rule in one source and what it draws. */
export function focusRules(text, file) {
    const src = stripComments(text);
    const rules = [];
    const open = /([^{};]*:focus(?:-visible|-within)?[^{};]*)\{/g;
    let m;
    while ((m = open.exec(src)) !== null) {
        let depth = 1;
        let k = m.index + m[0].length;
        while (depth > 0 && k < src.length) {
            if (src[k] === '{') depth += 1;
            else if (src[k] === '}') depth -= 1;
            k += 1;
        }
        const body = src.slice(m.index + m[0].length, k - 1);
        let own = body;
        while (/\{[^{}]*\}/.test(own)) own = own.replace(/\{[^{}]*\}/g, '');
        const draws = [];
        for (const d of own.matchAll(DRAWS)) draws.push({ prop: d[1], value: d[2].trim() });
        // Comments were blanked in `src`; the same span of the original says where a removed ring is drawn.
        const rawBody = text.slice(m.index + m[0].length, k - 1);
        rules.push({
            file,
            line: src.slice(0, m.index + m[0].length).split('\n').length,
            selector: m[1].trim().replace(/\s+/g, ' '),
            draws,
            ringNote: rawBody.match(/\/\*\s*ring:\s*([^*]+?)\s*\*\//)?.[1] ?? null,
        });
    }
    return rules;
}

/**
 * Whether a rule takes the ring away with nothing drawn instead: the removing declaration, or null. A rule in
 * styles.scss is the global one and is judged by what it draws.
 */
export function removal(rule) {
    if (/(^|\/)styles\.scss$/.test(rule.file)) return null;
    const away = rule.draws.find((d) => RING_PROP(d.prop) && REMOVES.test(d.value));
    if (!away) return null;
    const drawn = rule.draws.some((d) => RING_PROP(d.prop) && !REMOVES.test(d.value)
        && (RING.test(d.value) || SYSTEM.test(d.value)));
    return drawn ? null : away;
}

/** FOUND rows for one rule. */
export function judge(rule) {
    const found = [];
    const away = removal(rule);
    if (away !== null && rule.ringNote === null) {
        found.push({ kind: 'REMOVED', ...away, detail: 'takes the ring away; draws none, names none elsewhere' });
    }
    const ringDrawn = rule.draws.some((d) => !d.prop.startsWith('border') && RING.test(d.value));
    for (const d of rule.draws) {
        if (REMOVES.test(d.value) || NO_COLOUR.has(d.prop)) continue;
        const halo = translucentIn(d.value);
        if (halo !== null) {
            found.push({ kind: 'HALO', ...d, detail: halo });
            continue;
        }
        if (d.prop.startsWith('border')) {
            // the control's own edge beside the ring, or the ring itself
            if (RING.test(d.value) || ringDrawn) continue;
            if (!/#|rgb|hsl|var\(|color-mix|\b[a-z]+\s*$/.test(d.value)) continue;
            found.push({ kind: 'OFF-TOKEN', ...d, detail: 'an edge in another colour, and no ring' });
            continue;
        }
        if (RING.test(d.value) || SYSTEM.test(d.value)) {
            const other = d.value.replace(/var\(\s*--(cms-focus-ring|bs-focus-ring-color)[^)]*\)/g, '')
                .replace(GAP, '');
            if (/#[0-9a-f]|rgba?\(|hsla?\(|var\(/i.test(other)) {
                found.push({ kind: 'OFF-TOKEN', ...d, detail: 'the ring beside another colour' });
            }
            continue;
        }
        found.push({ kind: 'OFF-TOKEN', ...d, detail: 'not the ring' });
    }
    return found.map((f) => ({ file: rule.file, line: rule.line, selector: rule.selector, ...f }));
}

/** Bootstrap's focus variables, bound in styles.scss to the ring. */
export function bindingsMissing(styles) {
    const src = stripComments(styles);
    const missing = [];
    const block = (sel) => {
        const re = new RegExp(`(^|[\\n,}])\\s*${sel}\\s*\\{([^{}]*)\\}`, 'g');
        return [...src.matchAll(re)].map((x) => x[2]).join('\n');
    };
    const root = [...src.matchAll(/(^|[\n}])\s*:root\s*,[^{]*\{([^{}]*)\}/g)].map((x) => x[2]).join('\n');
    if (!/--bs-focus-ring-color\s*:\s*var\(--cms-focus-ring\)/.test(root)) {
        missing.push(':root: --bs-focus-ring-color is not var(--cms-focus-ring)');
    }
    if (!/--bs-focus-ring-opacity\s*:\s*1\b/.test(root)) missing.push(':root: --bs-focus-ring-opacity is not 1');
    const ringShadow = /var\(--bs-focus-ring-color\)|var\(--cms-focus-ring\)/;
    const btn = block('\\.btn').match(/--bs-btn-focus-box-shadow\s*:\s*([^;]+)/);
    if (!btn || !ringShadow.test(btn[1])) missing.push('.btn: --bs-btn-focus-box-shadow is not the ring');
    const close = block('\\.btn-close').match(/--bs-btn-close-focus-shadow\s*:\s*([^;]+)/);
    if (!close || !ringShadow.test(close[1])) missing.push('.btn-close: --bs-btn-close-focus-shadow is not the ring');
    const field = [...src.matchAll(/([^{}]*\.cms-field\b[^{}]*:focus[^{}]*)\{([^{}]*)\}/g)];
    const fieldDraws = field.some((f) => /outline\s*:\s*2px\s+solid\s+var\(--cms-focus-ring\)/.test(f[2]));
    if (!fieldDraws) missing.push('the field rule (.cms-field:focus) does not draw `outline: 2px solid var(--cms-focus-ring)`');
    return missing;
}

function sources(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...sources(p));
        else if (/\.(ts|scss|css)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(p);
    }
    return out;
}

/** The whole check over a source directory. */
export function check(srcDir) {
    let files = [];
    try {
        files = sources(srcDir);
    } catch {
        files = [];
    }
    const rules = files.flatMap((f) => focusRules(readFileSync(f, 'utf8'), relative(srcDir, f)));
    const found = rules.flatMap(judge);
    const waived = rules.filter((r) => r.ringNote !== null && removal(r) !== null)
        .map((r) => ({ file: r.file, line: r.line, selector: r.selector, note: r.ringNote }));
    let styles = null;
    try {
        styles = readFileSync(join(srcDir, 'styles.scss'), 'utf8');
    } catch {
        styles = null;
    }
    const bindings = styles === null ? null : bindingsMissing(styles);
    return { files: files.length, rules: rules.length, found, bindings, waived };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const dir = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
    const r = check(dir);
    if (r.files === 0 || r.rules === 0 || r.bindings === null) {
        console.log(`UNEVALUABLE: read ${r.files} source(s), ${r.rules} focus rule(s), styles.scss `
            + (r.bindings === null ? 'not found' : 'read') + ` -- under ${dir}`);
        process.exit(2);
    }
    const n = r.found.length + r.bindings.length;
    const waivers = () => {
        for (const w of r.waived) console.log(`  WAIVED ${w.file}:${w.line} ${w.selector.slice(0, 70)} -- ring: ${w.note}`);
    };
    if (n === 0) {
        console.log(`CLEAR: 0 of ${r.rules} focus rules in ${r.files} sources draw a halo, another colour or no ring;`
            + ` Bootstrap's focus variables are bound to the ring; ${r.waived.length} removal(s) waived`);
        waivers();
        process.exit(0);
    }
    console.log(`FOUND ${n}: ${r.found.length} of ${r.rules} focus rules' declarations, `
        + `${r.bindings.length} Bootstrap binding(s)`);
    for (const f of r.found) {
        console.log(`  ${f.kind} ${f.file}:${f.line} ${f.selector.slice(0, 80)} -- ${f.prop}: ${f.value.slice(0, 90)}`
            + ` (${f.detail.slice(0, 60)})`);
    }
    for (const b of r.bindings) console.log(`  BINDING styles.scss ${b}`);
    console.log(`  ${r.waived.length} removal(s) waived:`);
    waivers();
    process.exit(1);
}
