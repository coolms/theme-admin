#!/usr/bin/env node
// The words a person sees use no dash as a separator (Dmitry, 2026-11-27).
//
// WHY. The Generate document wizard said "Upload CSV -- Coming soon." and "This template has no user references -- only
// Single mode is available." UI text joins its parts with two short sentences, a comma or a colon; an en dash only
// stands between two values (1–5, Mon–Fri).
//
// WHAT IT READS: only text a person sees, in every component template under src/ (a `template:` literal, or an .html
// file): the text between tags, and the static attributes a person reads (title, placeholder, alt, aria-label, and any
// input named like a label, a title, a text, a hint, a help or a description). Never code, CSS or comments: an
// interpolation {{ ... }}, a bound attribute [x]="...", an Angular block (@if, @for ...), an HTML comment and a
// <style> are left out, so a custom property such as --cms-space-4 cannot trip it. theme-admin holds no translation
// files; the words live in the templates.
//
// WHAT FAILS (FOUND), in a string not on the grandfather list: an em dash; "--"; a spaced hyphen (" - "); an en dash
// anywhere but between two values with no spaces.
//
// THE GRANDFATHER LIST (scripts/check-ui-text.baseline.json): the strings that broke the rule when the check began,
// fixed as they are touched. It may only shrink: an entry whose string no longer breaks the rule is FOUND as stale
// (remove it), and with --base <git ref> an entry the base's list does not hold is FOUND as added.
//
// Exit: 0 CLEAR, 1 FOUND, 2 UNEVALUABLE (no template read, or the base's list unreadable).
//
// Run:  node scripts/check-ui-text.mjs [--base origin/develop] [--write-baseline] [--root <an angular/ folder>]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src');
/** A start tag, its quoted attribute values allowed to hold < and >. */
const TAG = /<[a-zA-Z](?:[^<>"'`]|"[^"]*"|'[^']*')*>/g;
const READ_ATTRS = /^(title|label|placeholder|alt|aria-label|[a-z][a-zA-Z]*(Label|Title|Text|Hint|Help|Description))$/;

/** What breaks the rule in one string: the reasons, empty when none. */
export function breaks(text) {
    const out = [];
    if (text.includes('—')) out.push('an em dash');
    if (text.includes('--')) out.push('"--"');
    if (/\s-\s|^-\s|\s-$/.test(text)) out.push('a spaced hyphen');
    for (let i = text.indexOf('–'); i !== -1; i = text.indexOf('–', i + 1)) {
        if (!(i > 0 && /\S/.test(text[i - 1]) && i + 1 < text.length && /\S/.test(text[i + 1]))) {
            out.push('an en dash not between two values');
            break;
        }
    }
    return out;
}

/** The strings a person sees in one template, each with its line in the template. */
export function visibleStrings(template) {
    let t = template;
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    t = t.replace(/<!--[\s\S]*?-->/g, blank);
    t = t.replace(/<style[\s\S]*?<\/style>/gi, blank);
    t = t.replace(/\{\{[\s\S]*?\}\}/g, blank);
    const out = [];
    const lineAt = (i) => t.slice(0, i).split('\n').length;
    // Static attributes a person reads, inside each tag.
    for (const tag of t.matchAll(TAG)) {
        for (const a of tag[0].matchAll(/\s([a-zA-Z][\w.-]*)=(?:"([^"]*)"|'([^']*)')/g)) {
            const value = (a[2] ?? a[3]).trim();
            if (READ_ATTRS.test(a[1]) && value !== '') out.push({ text: value, line: lineAt(tag.index) });
        }
    }
    // The text between tags, Angular blocks taken out.
    const textOnly = t.replace(TAG, blank).replace(/<\/[a-zA-Z][^<>]*>/g, blank)
        .replace(/@(if|else if|else|for|switch|case|default|empty|defer|placeholder|loading|error|let)\b[^{\n;]*[{;]?/g, blank)
        .replace(/[{}]/g, ' ');
    for (const m of textOnly.matchAll(/[^\n]+/g)) {
        const s = m[0].replace(/\s+/g, ' ').trim();
        if (/[A-Za-z]/.test(s)) out.push({ text: s, line: lineAt(m.index) });
    }
    return out;
}

/** Every template under src/: [file, template text]. */
export function templates(src = SRC) {
    const out = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (name.endsWith('.spec.ts')) continue;
            if (name.endsWith('.html')) out.push([p, readFileSync(p, 'utf8')]);
            else if (name.endsWith('.ts')) {
                const code = readFileSync(p, 'utf8');
                for (const m of code.matchAll(/\btemplate:\s*`((?:[^`\\]|\\[\s\S])*)`/g)) out.push([p, m[1]]);
            }
        }
    };
    walk(src);
    return out;
}

/** The strings that break the rule, as `file<TAB>text` keys, each with where it stands. */
export function findings(src = SRC, root = ROOT) {
    const out = new Map();
    for (const [file, tpl] of templates(src)) {
        for (const s of visibleStrings(tpl)) {
            const why = breaks(s.text);
            if (why.length) out.set(`${relative(root, file)}\t${s.text}`, why.join(', '));
        }
    }
    return out;
}

function readBaseline(text) {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('the baseline is not a list');
    return list;
}

function main(argv) {
    const write = argv.includes('--write-baseline');
    const b = argv.indexOf('--base');
    const base = b !== -1 ? argv[b + 1] : null;
    const r = argv.indexOf('--root');
    const root = r !== -1 ? resolve(argv[r + 1]) : ROOT;
    const src = join(root, 'src');
    const list = join(root, 'scripts', 'check-ui-text.baseline.json');
    const found = findings(src, root);
    if (templates(src).length === 0) { console.log('UNEVALUABLE -- no template read under src/'); return 2; }
    if (write) {
        writeFileSync(list, JSON.stringify([...found.keys()].sort(), null, 1) + '\n');
        console.log(`baseline written: ${found.size} grandfathered string(s)`);
        return 0;
    }
    const baseline = readBaseline(readFileSync(list, 'utf8'));
    const held = new Set(baseline);
    const fresh = [...found.keys()].filter((k) => !held.has(k));
    const stale = baseline.filter((k) => !found.has(k));
    let added = [];
    let begins = false;
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (base) {
        try {
            git(['rev-parse', '--verify', `${base}^{commit}`]);
        } catch {
            console.log(`UNEVALUABLE -- the base ${base} is not a commit here`);
            return 2;
        }
        try {
            git(['cat-file', '-e', `${base}:angular/scripts/check-ui-text.baseline.json`]);
        } catch {
            begins = true;
        }
    }
    if (base && !begins) {
        let before;
        try {
            before = new Set(readBaseline(git(['show', `${base}:angular/scripts/check-ui-text.baseline.json`])));
        } catch {
            console.log(`UNEVALUABLE -- the grandfather list at ${base} could not be read`);
            return 2;
        }
        added = baseline.filter((k) => !before.has(k));
    }
    const say = (k) => { const [f, t] = k.split('\t'); return `${f}: "${t}"`; };
    if (fresh.length || stale.length || added.length) {
        console.log('FOUND -- UI text joins its parts with a dash:');
        for (const k of fresh) console.log(`  ${say(k)} -- ${found.get(k)}; say it with two sentences, a comma or a colon`);
        for (const k of stale) console.log(`  stale on the grandfather list (remove it): ${say(k)}`);
        for (const k of added) console.log(`  added to the grandfather list, which may only shrink: ${say(k)}`);
        return 1;
    }
    console.log(`CLEAR -- no new dash in the words a person sees; ${baseline.length} grandfathered string(s) left to fix${begins ? ` (the list begins here: ${base} holds none)` : ''}`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
