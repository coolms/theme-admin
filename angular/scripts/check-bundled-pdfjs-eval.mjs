#!/usr/bin/env node
// The bundled pdf.js evaluates no strings beyond what a person has read (2026-10-07).
//
// The same tripwire as the mobile app's vendored pdf.js: every script of ngx-extended-pdf-viewer's assets that
// the admin's build SHIPS (angular.json's asset entry: its glob, at every depth, minus its ignore list) is searched for
// /\beval\s*\(/ and /\bFunction\s*\(/. Each match must lie inside a site in ALLOWED_EVAL_SITES -- pinned to
// one bundled version, by the exact text around the call and by how many times that text occurs. So:
//   - a new eval or Function( call is FOUND, with its file and offset;
//   - a second copy of an allowed text is FOUND ("occurs 2 times, more than the 1 read");
//   - a changed text leaves its call uncovered: FOUND;
//   - another bundled version gets no allowance: FOUND, until a person reads its sites and pins them;
//   - the allowed files are pinned by sha256 as well: any change to their BYTES, a rebuild of the same version
//     included, is FOUND, until a person re-quotes both sites for review and moves the pin (review of 2026-10-07:
//     both sites PASS, these hashes kept in the record).
// The scripting sandbox (pdf.sandbox-*.mjs) and its interpreter (wasm/quickjs-eval.*) are not shipped: scripting is
// pinned off in the viewer (@coolms/pdf-angular), and they are what evaluates a document's JavaScript.
//
// Exit: 0 CLEAR, 1 FOUND, 2 UNEVALUABLE (the asset entry or the files cannot be read).
//
// Run: npm run lint:bundled-pdfjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALLS = /\b(eval|Function)\s*\(/g;

// Both are core-js, compiled into the viewer and the worker alike: its global-object fallback, and its
// Node-only `require` fallback (reached only when a Node `process` exists, never in a browser).
const GLOBAL_FALLBACK = 'check("object"==typeof globalThis&&globalThis)||check("object"==typeof window&&window)'
    + '||check("object"==typeof self&&self)||check("object"==typeof global&&global)||check("object"==typeof this&&this)'
    + '||function(){return this}()||Function("return this")()';
const REQUIRE_FALLBACK = 'try{return Function(\'return require("\'+e+\'")\')()}catch(e){}';

/** Read by a person on 2026-10-07 in ngx-extended-pdf-viewer 29.0.1's assets, and reviewed: PASS. */
export const ALLOWED_EVAL_SITES = {
    version: '6.1.1164',
    // The bytes that were read and reviewed. A bump of ngx-extended-pdf-viewer re-quotes both sites for review,
    // whether or not their text changed: the pin moves only with that review.
    sha256: {
        'viewer-6.1.1164.min.mjs': '1f38921087d51a806b9b51c2407988b08a64dfd7ad86403629ef8e5a864126e5',
        'pdf.worker-6.1.1164.min.mjs': 'd4101bffdb4746bb5b994ecb8379a891809fc4a02375ee23f4886705b44c4d10',
    },
    sites: {
        'viewer-6.1.1164.min.mjs': [{ text: REQUIRE_FALLBACK, count: 1 }, { text: GLOBAL_FALLBACK, count: 1 }],
        'pdf.worker-6.1.1164.min.mjs': [{ text: REQUIRE_FALLBACK, count: 1 }, { text: GLOBAL_FALLBACK, count: 1 }],
    },
};

/** angular.json's ngx-extended-pdf-viewer asset entry: { input, ignore } (the file has line comments). */
export function assetEntry(angularJsonText) {
    const json = JSON.parse(angularJsonText.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
    const assets = Object.values(json.projects)[0].architect.build.options.assets;
    const entry = assets.find((a) => typeof a === 'object' && /ngx-extended-pdf-viewer\/assets\/?$/.test(a.input));
    if (!entry) throw new Error('angular.json copies no ngx-extended-pdf-viewer assets');
    return { input: entry.input, ignore: entry.ignore ?? [] };
}

// The ignore list's patterns ("**" + "/" + a file-name glob, any depth) as a test on a file's name.
function ignored(name, patterns) {
    name = basename(name);
    return patterns.some((p) => {
        const glob = p.replace(/^\*\*\//, '');
        const re = new RegExp('^' + glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
        return re.test(name);
    });
}

/** The script files (*.mjs, *.js) the build ships from `dir`, at every depth, as paths below it, minus the ignore list. */
export function shippedScripts(dir, ignore, below = '') {
    const out = [];
    for (const name of readdirSync(join(dir, below))) {
        const rel = below ? `${below}/${name}` : name;
        if (statSync(join(dir, rel)).isDirectory()) out.push(...shippedScripts(dir, ignore, rel));
        else if (/\.(m?js)$/.test(name) && !ignored(rel, ignore)) out.push(rel);
    }
    return out.sort();
}

/** Every uncovered call and every over-counted allowed text in `files` ({name: text}). */
export function findings(files, allowed) {
    const out = [];
    const versions = new Set(Object.keys(files).map((n) => /-(\d+\.\d+\.\d+)[.-]/.exec(basename(n))?.[1]).filter(Boolean));
    for (const v of versions) {
        if (v !== allowed.version) out.push(`bundled pdf.js ${v} has no allowance (pinned to ${allowed.version}): a person reads its sites first`);
    }
    for (const [name, text] of Object.entries(files)) {
        const sites = allowed.sites[name] ?? [];
        const covered = [];
        for (const site of sites) {
            let at = text.indexOf(site.text);
            let n = 0;
            while (at !== -1) {
                covered.push([at, at + site.text.length]);
                n++;
                at = text.indexOf(site.text, at + 1);
            }
            if (n > site.count) out.push(`${name}: an allowed site occurs ${n} times, more than the ${site.count} read`);
        }
        for (const m of text.matchAll(CALLS)) {
            if (!covered.some(([a, b]) => m.index >= a && m.index < b)) {
                out.push(`evaluates strings, held for a person to read: ${name}:${m.index} ${m[1]}(`);
            }
        }
    }
    return out;
}

/**
 * Every allowed file whose BYTES are not the bytes that were read: FOUND, whatever its text, until a person
 * re-quotes both sites for review and moves the pin. `files` maps a shipped name to its bytes (a Buffer, as read
 * from disk -- no text round trip in between) or a string.
 */
export function hashFindings(files, allowed) {
    const out = [];
    for (const name of Object.keys(allowed.sites)) {
        if (files[name] === undefined) continue; // not shipped: the version check speaks for it
        const want = allowed.sha256?.[name];
        const got = createHash('sha256').update(files[name]).digest('hex');
        if (!want) {
            out.push(`${name}: no sha256 pinned for the bytes that were read`);
        } else if (got !== want) {
            out.push(`${name}: its bytes changed (sha256 ${got.slice(0, 16)}, read as ${want.slice(0, 16)}) -- `
                + 'a person re-quotes both string-to-code sites for review before the pin moves');
        }
    }
    return out;
}

function main() {
    let entry, dir, names;
    try {
        entry = assetEntry(readFileSync(join(ROOT, 'angular.json'), 'utf8'));
        dir = process.env.BUNDLED_PDFJS_ASSETS || join(ROOT, entry.input);
        if (!existsSync(dir)) throw new Error(`${dir} does not exist (install first)`);
        names = shippedScripts(dir, entry.ignore);
        if (names.length === 0) throw new Error(`no shipped script in ${dir}`);
    } catch (e) {
        console.log(`bundled-pdfjs-eval: UNEVALUABLE -- ${e.message}`);
        process.exit(2);
    }
    const files = Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    const calls = Object.values(files).reduce((sum, t) => sum + [...t.matchAll(CALLS)].length, 0);
    console.log(`bundled-pdfjs-eval: ${names.length} shipped script(s) (${names.join(', ')}), ${calls} eval/Function call(s)`);
    const bytes = Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n))]));
    const found = [...findings(files, ALLOWED_EVAL_SITES), ...hashFindings(bytes, ALLOWED_EVAL_SITES)];
    for (const f of found) console.log(`  ${f}`);
    if (found.length) {
        console.log(`bundled-pdfjs-eval: FOUND -- ${found.length} finding(s)`);
        process.exit(1);
    }
    console.log(`bundled-pdfjs-eval: CLEAR -- every call is a site read and pinned for ${ALLOWED_EVAL_SITES.version}, `
        + 'and the files are the bytes that were reviewed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
