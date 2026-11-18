#!/usr/bin/env node
// Copied unchanged from coolms/theme-workspace tools/theme-version-check.mjs at c59b9a8.
// theme-version-check.mjs -- does a theme's manifest carry the version it ships?
//
//   node tools/theme-version-check.mjs <theme.yaml> [<package.json | composer.json>] [--tag <tag>] [--changelog <file>]
//
// The server lists and installs a theme from its theme.yaml; the version people see there has to be the one the theme
// ships. This reads the manifest's top-level `version:` and holds it to:
//   - the package file's "version" (an npm package.json, or a composer.json that declares one): always the same string;
//   - with --tag, the latest release tag (a leading "v" dropped): the same string, unless a release is under way;
//   - with --changelog, the first heading of the changelog that names a version ("## 2.0.0-alpha8 - <date>",
//     "## 0.1.0-alpha.14 (<date>)"; a heading "## Unreleased" is skipped). When it is not the latest tag, a release
//     is under way (its pull request raises the changelog and the manifest before the tag exists) and the manifest must
//     carry that version, not the tag's; without --tag (no release yet), the manifest must carry it too.
// At least one of a package file, --tag and --changelog is needed. An empty --tag (git describe found no tag) is
// UNEVALUABLE unless --changelog gives the version under way; a changelog that names no version is UNEVALUABLE.
// Prints one line. Exit 0 CLEAR, 1 FOUND (a version differs), 2 UNEVALUABLE (a file unreadable, or nothing to compare).
// Node built-ins only, so any theme repository can call it.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const options = {};
const files = [];
for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--tag' || args[i] === '--changelog') {
        options[args[i].slice(2)] = args[i + 1] ?? null;
        i += 1;
    } else {
        files.push(args[i]);
    }
}
const [manifestPath, packagePath] = files;
const tag = 'tag' in options ? options.tag : undefined;
const changelogPath = 'changelog' in options ? options.changelog : undefined;

const say = (line, code) => {
    process.stdout.write(`theme version ${line}\n`);
    process.exit(code);
};
const usage = 'usage: theme-version-check.mjs <theme.yaml> [<package.json | composer.json>] [--tag <tag>] [--changelog <file>]';
if (manifestPath === undefined || files.length > 2 || tag === null || changelogPath === null) say(`UNEVALUABLE: ${usage}`, 2);
if (packagePath === undefined && tag === undefined && changelogPath === undefined) say(`UNEVALUABLE: ${usage}`, 2);

const read = (path, what) => {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        say(`UNEVALUABLE: ${what} ${path} could not be read (${error.message})`, 2);
    }
};

// A top-level `version:` line, unquoted or quoted; a version nested under another key is not the manifest's.
const found = read(manifestPath, 'the manifest').match(/^version:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^#\n]*?))[ \t]*(?:#.*)?$/m);
const declared = found === null ? null : (found[1] ?? found[2] ?? found[3] ?? '').trim();
if (declared === null || declared === '') say(`UNEVALUABLE: ${manifestPath} declares no version`, 2);

const differ = [];
const held = [];

if (packagePath !== undefined) {
    let data;
    try {
        data = JSON.parse(read(packagePath, 'the package file'));
    } catch (error) {
        say(`UNEVALUABLE: ${packagePath} could not be read as JSON (${error.message})`, 2);
    }
    if (typeof data?.version === 'string' && data.version !== '') {
        held.push(packagePath);
        if (data.version !== declared) differ.push(`${packagePath} says ${data.version}`);
    } else if (tag === undefined && changelogPath === undefined) {
        say(`UNEVALUABLE: ${packagePath} declares no version and neither --tag nor --changelog was given`, 2);
    }
}

let next = null;
if (changelogPath !== undefined) {
    // The first `## ` heading that starts with a version; "Unreleased" and other words are not one.
    const heading = read(changelogPath, 'the changelog').match(/^##[ \t]+v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/m);
    if (heading === null) say(`UNEVALUABLE: ${changelogPath} has no heading that names a version`, 2);
    next = heading[1];
}

const latest = tag === undefined || tag.trim() === '' ? null : tag.trim().replace(/^v/, '');
if (tag !== undefined && latest === null && next === null) say('UNEVALUABLE: --tag is empty (no release tag to compare with)', 2);

if (latest !== null) {
    held.push(`tag ${tag}`);
    if (next !== null && next !== latest) {
        // A release under way: the changelog names a version the latest tag is not, and the manifest has to carry it.
        held.push(`${changelogPath} (${next}, under way)`);
        if (declared !== next) differ.push(`${changelogPath} is raising tag ${tag} to ${next}`);
    } else {
        if (next !== null) held.push(`${changelogPath} (${next})`);
        if (declared !== latest) differ.push(`tag ${tag} says ${latest}`);
    }
} else if (next !== null) {
    // No release yet: the manifest carries the version the changelog names.
    held.push(`${changelogPath} (${next})`);
    if (declared !== next) differ.push(`${changelogPath} says ${next}`);
}

if (differ.length > 0) say(`FOUND: ${manifestPath} says ${declared}; ${differ.join('; ')}`, 1);
say(`CLEAR: ${declared} in ${manifestPath}, held to ${held.join(' and ')}`, 0);
