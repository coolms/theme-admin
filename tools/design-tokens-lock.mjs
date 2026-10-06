#!/usr/bin/env node
// The design tokens come from coolms/design-tokens at a tagged version: this repository keeps a copy
// of each file it uses, and design-tokens.lock.json records the tag, its commit and each copy's
// sha256. This checks the copies against the lock.
//
//   node tools/design-tokens-lock.mjs            offline: each copy hashes to the lock's sha256
//   node tools/design-tokens-lock.mjs --network  also: the tag names the lock's commit, and each
//                                                file at that commit hashes the same
//
// To move to a new version: copy the files at the new tag, then update the lock's tag, commit and
// sha256 in the same pull request.
//
// Exit: 0 CLEAR; 1 FOUND -- a copy or the tag does not match the lock; 2 UNEVALUABLE -- the lock
// could not be read, or (--network) GitHub could not be asked.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = 'design-tokens.lock.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class Unevaluable extends Error {}

function readLock() {
    let lock;
    try {
        lock = JSON.parse(readFileSync(join(root, LOCK), 'utf8'));
    } catch (error) {
        throw new Unevaluable(`${LOCK} could not be read: ${error.message}`);
    }
    const files = Object.entries(lock?.files ?? {});
    if (!lock?.repository || !lock?.tag || !/^[0-9a-f]{40}$/.test(lock?.commit ?? '') || files.length === 0) {
        throw new Unevaluable(`${LOCK} needs a repository, a tag, a 40-character commit and at least one file`);
    }
    return { lock, files };
}

function offline({ files }) {
    const found = [];
    for (const [from, { to, sha256: want }] of files) {
        let have = null;
        try {
            have = sha256(readFileSync(join(root, to)));
        } catch {
            // absent: a mismatch
        }
        if (have !== want) {
            found.push(`${to} (from ${from}) ${have === null ? 'is missing' : `hashes to ${have}, the lock says ${want}`}`);
        }
    }
    return found;
}

/** A response, or null for a 404 (the thing does not exist: a mismatch, never a failure to ask). */
async function ask(url) {
    let response;
    try {
        response = await fetch(url, { headers: { 'User-Agent': 'design-tokens-lock' } });
    } catch (error) {
        throw new Unevaluable(`${url} could not be asked: ${error.message}`);
    }
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Unevaluable(`${url} answered ${response.status}`);
    }
    return response;
}

async function network({ lock, files }) {
    const found = [];
    const api = `https://api.github.com/repos/${lock.repository}`;
    const ref = await ask(`${api}/git/ref/tags/${encodeURIComponent(lock.tag)}`);
    let target = ref === null ? null : (await ref.json()).object;
    // An annotated tag points at a tag object; follow it to the commit.
    while (target?.type === 'tag') {
        const tag = await ask(`${api}/git/tags/${target.sha}`);
        target = tag === null ? null : (await tag.json()).object;
    }
    if (target === null) {
        found.push(`tag ${lock.tag} does not exist in ${lock.repository}`);
    } else if (target.sha !== lock.commit) {
        found.push(`tag ${lock.tag} names ${target.sha}, the lock says ${lock.commit}`);
    }
    for (const [from, { sha256: want }] of files) {
        const raw = await ask(`https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/${from}`);
        if (raw === null) {
            found.push(`${from} does not exist at ${lock.commit.slice(0, 7)}`);
            continue;
        }
        const have = sha256(Buffer.from(await raw.arrayBuffer()));
        if (have !== want) {
            found.push(`${from} at ${lock.commit.slice(0, 7)} hashes to ${have}, the lock says ${want}`);
        }
    }
    return found;
}

try {
    const read = readLock();
    const found = offline(read);
    const asked = process.argv.includes('--network');
    if (asked) {
        found.push(...await network(read));
    }
    const what = `${read.files.length} file(s) of ${read.lock.repository} ${read.lock.tag}`
        + (asked ? ', and the tag and files at its commit' : '');
    if (found.length) {
        console.log(`FOUND -- ${found.length} mismatch(es) against ${LOCK} (${what}):\n  ${found.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`CLEAR -- ${what} match ${LOCK}`);
    process.exit(0);
} catch (error) {
    console.log(`UNEVALUABLE -- ${error.message}`);
    process.exit(2);
}
