#!/usr/bin/env node
// ONE-TIME: reads the two hand-written token blocks of angular/src/styles.scss -- `:root` and
// `:root[data-theme='dark']` -- into tokens/coolms.tokens.json, and reports whether what
// tools/design-tokens.mjs generates from that file declares exactly the same name/value pairs.
// Step (a) of generating the admin's and the app's tokens from one file (agreed 2026-10-05):
// nothing changes for the admin yet. Step (b) imports the generated file and deletes the two
// blocks, and this script with them.
//
//   node tools/design-tokens-extract.mjs            write the token file, then compare
//   node tools/design-tokens-extract.mjs --compare  compare only
//
// Exit: 0 the generated blocks declare exactly the stylesheet's pairs; 1 they differ (each
// difference named); 2 could not run.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(root, 'angular/src/styles.scss');
const TOKENS = join(root, 'tokens/coolms.tokens.json');
const GENERATED = join(root, 'angular/src/tokens.generated.scss');

// Why each colour with no dark value does not flip (measured 2026-10-05).
const INVARIANT = {
    'accent': 'the brand amber, one in both schemes',
    'accent-hover': 'the brand amber, one in both schemes',
    'accent-fg': 'text on the brand amber, one in both schemes (8.59:1 on accent, 6.86:1 on accent-hover)',
    'checker-light': 'drawn over the canvas backdrop, which is the sidebar navy in both schemes',
    'checker-dark': 'DEAD: 0 uses (2026-10-05); removed after step (b)',
    'code-bg': 'code is shown on a dark panel in both schemes',
    'code-text': 'code is shown on a dark panel in both schemes',
    'on-chrome': 'the chrome is navy in both schemes',
    'sidebar-text': 'the chrome is navy in both schemes',
    'sidebar-text-muted': 'the chrome is navy in both schemes',
    'paper': 'a white page in both schemes',
    'paper-text': 'a white page in both schemes',
    'paper-link': 'a white page in both schemes',
    'paper-muted': 'a white page in both schemes',
    'filetype-resource': 'one icon colour in both schemes (4.24:1 light, 4.03:1 dark on bg)',
    'filetype-directory': 'FINDING: under 3:1 on light surfaces; a light value follows',
    'filetype-package': 'FINDING: under 3:1 on light surfaces; a light value follows',
};

/** The custom properties declared in the first block that STARTS with `opener`, name -> value, in order. */
export function blockOf(css, opener) {
    const at = css.search(opener);
    if (at < 0) {
        return null;
    }
    const open = css.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
        if (css[end] === '{') {
            depth++;
        } else if (css[end] === '}' && --depth === 0) {
            break;
        }
    }
    const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pairs = new Map();
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        pairs.set(m[1], m[2].trim().replace(/\s+/g, ' '));
    }
    return pairs;
}

const LIGHT = /^:root\s*\{/m;
const DARK = /^:root\[data-theme='dark'\]\s*\{/m;
const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;

function typeOf(value, light) {
    const alias = /^var\(--cms-([a-z0-9-]+)\)$/.exec(value);
    if (alias) {
        return typeOf(light.get('--cms-' + alias[1]), light);
    }
    if (COLOUR.test(value)) {
        return 'color';
    }
    if (/^-?\d+(\.\d+)?(px|vh|rem|em)$/.test(value)) {
        return 'dimension';
    }
    if (/\d+px .*rgba?\(/.test(value)) {
        return 'shadow';
    }
    return 'fontFamily';
}

function extract() {
    const css = readFileSync(STYLES, 'utf8');
    const light = blockOf(css, LIGHT);
    const dark = blockOf(css, DARK);
    if (!light || !dark) {
        throw new Error('the two token blocks were not found in ' + STYLES);
    }
    const cms = {};
    for (const [name, value] of light) {
        const key = name.replace(/^--cms-/, '');
        const alias = /^var\(--cms-([a-z0-9-]+)\)$/.exec(value);
        const token = { $type: typeOf(value, light), $value: alias ? `{cms.${alias[1]}}` : value };
        const ext = {};
        if (dark.has(name)) {
            ext.dark = dark.get(name);
        } else if (token.$type === 'color' && !alias) {
            if (!INVARIANT[key]) {
                throw new Error(`${name} has no dark value and no stated reason: add it to INVARIANT`);
            }
            ext.invariant = INVARIANT[key];
        }
        if (Object.keys(ext).length) {
            token.$extensions = { 'org.coolms': ext };
        }
        cms[key] = token;
    }
    const file = {
        $description: 'The design tokens of the admin and the app: ONE source, so the two cannot drift apart. tools/design-tokens.mjs'
            + ' writes the admin\'s :root blocks (angular/src/tokens.generated.scss) and the app\'s plain-data module'
            + ' (tokens/coolms-tokens.ts) from it. A colour that does not flip in dark says why ("invariant");'
            + ' the generator refuses one that says neither. Shadows and the font stack are CSS strings here, not'
            + ' DTCG\'s structured form: only the stylesheet reads them.',
        cms,
    };
    writeFileSync(TOKENS, JSON.stringify(file, null, 4) + '\n');
    return { light: light.size, dark: dark.size };
}

function compare() {
    const css = readFileSync(STYLES, 'utf8');
    const generated = readFileSync(GENERATED, 'utf8');
    let differences = 0;
    for (const [label, opener] of [['light', LIGHT], ['dark', DARK]]) {
        const want = blockOf(css, opener);
        const got = blockOf(generated, opener);
        for (const [name, value] of want) {
            if (got.get(name) !== value) {
                differences++;
                console.log(`  ${label} ${name}: stylesheet "${value}", generated "${got.get(name) ?? '(absent)'}"`);
            }
        }
        for (const name of got.keys()) {
            if (!want.has(name)) {
                differences++;
                console.log(`  ${label} ${name}: generated only`);
            }
        }
        console.log(`${label}: ${want.size} pairs in the stylesheet, ${got.size} generated`);
    }
    console.log(differences === 0
        ? 'CLEAR -- the generated blocks declare exactly the stylesheet\'s name/value pairs'
        : `FOUND -- ${differences} difference(s)`);
    return differences === 0 ? 0 : 1;
}

try {
    if (!process.argv.includes('--compare')) {
        const counts = extract();
        console.log(`extracted: ${counts.light} light, ${counts.dark} dark -> ${TOKENS}`);
        console.log('now run: node tools/design-tokens.mjs, then: node tools/design-tokens-extract.mjs --compare');
        process.exit(0);
    }
    process.exit(compare());
} catch (error) {
    console.log('UNEVALUABLE -- ' + error.message);
    process.exit(2);
}
