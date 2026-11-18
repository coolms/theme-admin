#!/usr/bin/env node
// Copied unchanged from coolms/theme-workspace tools/theme-version-check.mjs at 5dfb487.
// theme-version-check.mjs -- does a theme's manifest carry its package's version (and its release tag's)?
//
//   node tools/theme-version-check.mjs <theme.yaml> <package.json | composer.json> [--tag <tag>]
//
// The server lists and installs a theme from its theme.yaml; the version people see there has to be the one the theme
// ships. This reads `version:` from the manifest and "version" from the package file (an npm package.json, or a
// composer.json that declares one), and, with --tag, the release tag (a leading "v" is dropped). They must be the same
// string. A composer.json without a version gives nothing to compare: name the npm package file of a theme that has
// one, or pass --tag alone for a theme whose version lives only in its tags.
// Prints one line. Exit 0 CLEAR, 1 FOUND (a version differs), 2 UNEVALUABLE (a file unreadable, or nothing to compare).
// Node built-ins only, so any theme repository can call it.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const tagAt = args.indexOf('--tag');
const tag = tagAt === -1 ? null : args[tagAt + 1] ?? null;
const files = args.filter((_, i) => tagAt === -1 || (i !== tagAt && i !== tagAt + 1));
const [manifestPath, packagePath] = files;

const say = (line, code) => {
    process.stdout.write(`theme version ${line}\n`);
    process.exit(code);
};
if (manifestPath === undefined || (packagePath === undefined && tag === null) || (tagAt !== -1 && tag === null)) {
    say('UNEVALUABLE: usage: theme-version-check.mjs <theme.yaml> <package.json | composer.json> [--tag <tag>]', 2);
}
// An empty tag is a repository with no release yet (git describe found none): there is no release to compare with.
if (tag !== null && tag.trim() === '') say('UNEVALUABLE: --tag is empty (no release tag to compare with)', 2);

let manifest;
try {
    manifest = readFileSync(manifestPath, 'utf8');
} catch (error) {
    say(`UNEVALUABLE: ${manifestPath} could not be read (${error.message})`, 2);
}
// A top-level `version:` line, unquoted or quoted; a version nested under another key is not the manifest's.
const found = manifest.match(/^version:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^#\n]*?))[ \t]*(?:#.*)?$/m);
const declared = found === null ? null : (found[1] ?? found[2] ?? found[3] ?? '').trim();
if (declared === null || declared === '') say(`UNEVALUABLE: ${manifestPath} declares no version`, 2);

const compared = [];
if (packagePath !== undefined) {
    let data;
    try {
        data = JSON.parse(readFileSync(packagePath, 'utf8'));
    } catch (error) {
        say(`UNEVALUABLE: ${packagePath} could not be read as JSON (${error.message})`, 2);
    }
    if (typeof data?.version === 'string' && data.version !== '') compared.push([packagePath, data.version]);
    else if (tag === null) say(`UNEVALUABLE: ${packagePath} declares no version and no --tag was given`, 2);
}
if (tag !== null) compared.push([`tag ${tag}`, tag.replace(/^v/, '')]);

const differ = compared.filter(([, version]) => version !== declared);
if (differ.length > 0) {
    say(`FOUND: ${manifestPath} says ${declared}; ${differ.map(([where, version]) => `${where} says ${version}`).join('; ')}`, 1);
}
say(`CLEAR: ${declared} in ${manifestPath} and ${compared.map(([where]) => where).join(' and ')}`, 0);
