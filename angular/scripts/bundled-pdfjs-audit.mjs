#!/usr/bin/env node
// The pdf.js that ngx-extended-pdf-viewer BUNDLES, audited like a dependency (2026-10-07).
//
// npm audit sees ngx-extended-pdf-viewer, not the pdf.js inside its assets, so an advisory against that
// pdf.js (pdfjs-dist) is invisible to it. This reads the bundled version and asks npm's advisory database
// what affects pdfjs-dist at that version, and prints the answer in the shape `npm audit --json` prints.
// The shared advisories job (coolms/.github, npm-advisories.yml) runs it as its audit command, so the bundled
// pdf.js is held to the same rules as every dependency: a new advisory, a listed one gone, one re-rated
// higher and a line past its review date fail, and an unreachable registry is retried, then UNEVALUABLE.
// Its list is .github/bundled-advisories.txt.
//
// The version comes from the package AS LOCKED: the installed copy when node_modules holds that version,
// otherwise the tarball itself (npm pack, checked against the lockfile's integrity) -- the job installs
// nothing. Read from the shipped file names (viewer-<v>.min.mjs, pdf.worker-<v>.min.mjs) and from the
// viewer's own version string; they must agree, or the answer is an error, never a guess.
//
// stdout: the report (or npm's error shapes: a network failure in `message`, a registry 5xx as
// `statusCode`, anything else as `error.code`). stderr: what was read. Exit 0 when a report was printed.
//
// BUNDLED_PDFJS_ASSETS reads a directory of asset files instead (the self-test's throwaway copies);
// BUNDLED_PDFJS_REGISTRY replaces https://registry.npmjs.org.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = 'ngx-extended-pdf-viewer';
const FILE = /^(viewer|pdf\.worker)-(\d+\.\d+\.\d+)\.min\.mjs$/;

/** The bundled pdf.js version in `dir`, read from the shipped file names and the viewer's own string. */
export function bundledVersion(dir) {
    const names = readdirSync(dir);
    const found = new Map();
    for (const name of names) {
        const m = FILE.exec(name);
        if (m) found.set(m[1], { name, version: m[2] });
    }
    for (const kind of ['viewer', 'pdf.worker']) {
        if (!found.has(kind)) throw new Error(`no ${kind}-<version>.min.mjs in ${dir}`);
    }
    const viewer = found.get('viewer');
    const worker = found.get('pdf.worker');
    if (viewer.version !== worker.version) {
        throw new Error(`the viewer is ${viewer.version} and the worker ${worker.version}`);
    }
    const text = readFileSync(join(dir, viewer.name), 'utf8');
    if (!text.includes(`"${viewer.version}"`)) {
        throw new Error(`${viewer.name} does not carry the version string "${viewer.version}"`);
    }
    return viewer.version;
}

/** The assets directory of the package as the lockfile has it; `cleanup` removes what was fetched. */
function lockedAssets(root) {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const entry = lock.packages?.[`node_modules/${PACKAGE}`];
    if (!entry?.version) throw new Error(`${PACKAGE} is not in package-lock.json`);
    const installed = join(root, 'node_modules', PACKAGE);
    if (existsSync(join(installed, 'package.json'))
        && JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version === entry.version) {
        return { dir: join(installed, 'assets'), locked: entry.version, cleanup: () => {} };
    }
    const tmp = mkdtempSync(join(tmpdir(), 'bundled-pdfjs-'));
    const tgz = execFileSync('npm', ['pack', `${PACKAGE}@${entry.version}`, '--pack-destination', tmp, '--silent'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop();
    const bytes = readFileSync(join(tmp, tgz));
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (entry.integrity && entry.integrity !== integrity) {
        rmSync(tmp, { recursive: true, force: true });
        throw new Error(`the ${PACKAGE}@${entry.version} tarball does not match the lockfile's integrity`);
    }
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', tmp, '--wildcards', 'package/assets/*.mjs']);
    return { dir: join(tmp, 'package', 'assets'), locked: entry.version, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** npm's bulk advisory answer for pdfjs-dist at `version`, as an `npm audit --json` report (auditReportVersion 2). */
export async function auditReport(version, registry) {
    const url = `${registry.replace(/\/$/, '')}/-/npm/v1/security/advisories/bulk`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ 'pdfjs-dist': [version] }),
            signal: AbortSignal.timeout(60_000),
        });
    } catch (e) {
        const code = e?.cause?.code ?? (e?.name === 'TimeoutError' ? 'ETIMEDOUT' : 'ENETWORK');
        return { message: `request to ${url} failed, reason: ${code}`, error: { summary: '', detail: '' } };
    }
    if (!res.ok) {
        return { message: `${res.status} ${res.statusText} - POST ${url}`, statusCode: res.status, error: { summary: '', detail: '' } };
    }
    const advisories = (await res.json())['pdfjs-dist'] ?? [];
    const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    const via = advisories.map((a) => {
        counts[a.severity] = (counts[a.severity] ?? 0) + 1;
        return { source: a.id, name: 'pdfjs-dist', dependency: 'pdfjs-dist', title: a.title, url: a.url,
            severity: a.severity, range: a.vulnerable_versions };
    });
    const worst = via.reduce((w, v) => (rank[v.severity] > rank[w] ? v.severity : w), 'info');
    return {
        auditReportVersion: 2,
        vulnerabilities: via.length === 0 ? {} : {
            'pdfjs-dist': { name: 'pdfjs-dist', severity: worst, isDirect: false, via, effects: [PACKAGE],
                range: via.map((v) => v.range).join(' || '), nodes: [`node_modules/${PACKAGE}`], fixAvailable: false },
        },
        metadata: { vulnerabilities: { ...counts, total: via.length }, bundled: { package: PACKAGE, 'pdfjs-dist': version } },
    };
}

async function main() {
    const registry = process.env.BUNDLED_PDFJS_REGISTRY || 'https://registry.npmjs.org';
    let assets;
    try {
        assets = process.env.BUNDLED_PDFJS_ASSETS
            ? { dir: process.env.BUNDLED_PDFJS_ASSETS, locked: '(a directory given)', cleanup: () => {} }
            : lockedAssets(process.cwd());
        const version = bundledVersion(assets.dir);
        console.error(`bundled-pdfjs: ${PACKAGE} ${assets.locked} bundles pdf.js ${version}`);
        process.stdout.write(JSON.stringify(await auditReport(version, registry)) + '\n');
    } catch (e) {
        process.stdout.write(JSON.stringify({ error: { code: 'EBUNDLEDPDFJS', summary: String(e.message).slice(0, 300) } }) + '\n');
    } finally {
        assets?.cleanup();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
