// The bundled pdf.js checks on small fixtures: the version read, the advisory answer, the eval tripwire.
// Run: npm run test:scripts (the two cases that ask the registry run when BUNDLED_PDFJS_NETWORK=1, as CI sets).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditReport, bundledVersion } from './bundled-pdfjs-audit.mjs';
import { ALLOWED_EVAL_SITES, assetEntry, findings, shippedScripts } from './check-bundled-pdfjs-eval.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NETWORK = process.env.BUNDLED_PDFJS_NETWORK === '1';
const REGISTRY = 'https://registry.npmjs.org';

function assets(files) {
    const dir = mkdtempSync(join(tmpdir(), 'bundled-pdfjs-test-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
}

const v = ALLOWED_EVAL_SITES.version;
const [viewerSites, workerSites] = Object.values(ALLOWED_EVAL_SITES.sites);
const real = (version, extra = '') => ({
    [`viewer-${version}.min.mjs`]: `const pdfjsVersion="${version}";${viewerSites.map((s) => s.text).join(';')}${extra}`,
    [`pdf.worker-${version}.min.mjs`]: workerSites.map((s) => s.text).join(';'),
});

test('the version is read from the shipped names and the viewer\'s own string', () => {
    assert.equal(bundledVersion(assets(real(v))), v);
});

test('a viewer and a worker of different versions are an error, not a guess', () => {
    const files = { ...real(v), 'pdf.worker-9.9.9.min.mjs': '' };
    delete files[`pdf.worker-${v}.min.mjs`];
    assert.throws(() => bundledVersion(assets(files)), /the viewer is 6\.1\.1164 and the worker 9\.9\.9/);
});

test('a viewer that does not carry its version string is an error', () => {
    assert.throws(() => bundledVersion(assets({ [`viewer-${v}.min.mjs`]: 'no version here', [`pdf.worker-${v}.min.mjs`]: '' })),
        /does not carry the version string/);
});

test('an unreachable registry answers in npm\'s network shape, so the job retries and then refuses', async () => {
    // A port just opened and closed again: nothing listens there. (fetch refuses a few well-known ports, 9 among
    // them, as "bad port" before connecting -- that is not the network, and would not be retried.)
    const server = createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address();
    await new Promise((ok) => server.close(ok));
    const r = await auditReport(v, `http://127.0.0.1:${port}`);
    assert.match(r.message, /failed, reason: ECONNREFUSED/);
    assert.equal(r.vulnerabilities, undefined);
});

test('the bundled 6.1.1164 is reported with GHSA-hq66-cqwq-w95j', { skip: !NETWORK && 'BUNDLED_PDFJS_NETWORK=1 asks the registry' }, async () => {
    const r = await auditReport(v, REGISTRY);
    const ids = r.vulnerabilities['pdfjs-dist'].via.map((a) => a.url.split('/').pop());
    assert.ok(ids.includes('GHSA-hq66-cqwq-w95j'), ids.join(', '));
});

test('the mutation: a copy bundling 4.1.392 is reported with CVE-2024-4367 (GHSA-wgrm-67xf-hhpq)', { skip: !NETWORK && 'BUNDLED_PDFJS_NETWORK=1 asks the registry' }, async () => {
    const dir = assets(real('4.1.392'));
    const r = await auditReport(bundledVersion(dir), REGISTRY);
    const ids = r.vulnerabilities['pdfjs-dist'].via.map((a) => a.url.split('/').pop());
    assert.ok(ids.includes('GHSA-wgrm-67xf-hhpq'), ids.join(', '));
});

test('tripwire control: exactly the pinned sites is clear', () => {
    assert.deepEqual(findings(real(v), ALLOWED_EVAL_SITES), []);
});

test('tripwire: a planted eval( is found by file and offset', () => {
    const files = real(v, ';eval("1+1")');
    const found = findings(files, ALLOWED_EVAL_SITES);
    assert.equal(found.length, 1);
    assert.match(found[0], new RegExp(`viewer-${v.replace(/\./g, '\\.')}\\.min\\.mjs:\\d+ eval\\(`));
});

test('tripwire: a second copy of an allowed text is found', () => {
    const files = real(v, `;${viewerSites[1].text}`);
    assert.ok(findings(files, ALLOWED_EVAL_SITES).some((f) => /occurs 2 times, more than the 1 read/.test(f)));
});

test('tripwire: a changed text leaves its call uncovered', () => {
    const files = real(v);
    files[`viewer-${v}.min.mjs`] = files[`viewer-${v}.min.mjs`].replace('Function("return this")', 'Function("return  this")');
    assert.ok(findings(files, ALLOWED_EVAL_SITES).some((f) => /evaluates strings.*Function\(/.test(f)));
});

test('tripwire: another bundled version gets no allowance', () => {
    assert.ok(findings(real('6.2.200'), ALLOWED_EVAL_SITES).some((f) => /6\.2\.200 has no allowance/.test(f)));
});

test('a planted eval( in a script below the top level is found too', () => {
    const dir = assets(real(v));
    mkdirSync(join(dir, 'wasm'));
    writeFileSync(join(dir, 'wasm', 'planted_fallback.js'), 'eval("1+1")');
    const names = shippedScripts(dir, []);
    assert.ok(names.includes('wasm/planted_fallback.js'), names.join(', '));
    const files = Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    assert.ok(findings(files, ALLOWED_EVAL_SITES).some((f) => /wasm\/planted_fallback\.js:\d+ eval\(/.test(f)));
});

test('the build ships no scripting sandbox nor its interpreter, and without the ignore lines both would ship', () => {
    const entry = assetEntry(readFileSync(join(ROOT, 'angular.json'), 'utf8'));
    assert.ok(entry.ignore.includes('**/pdf.sandbox-*'), entry.ignore.join(', '));
    assert.ok(entry.ignore.includes('**/quickjs-eval.*'), entry.ignore.join(', '));
    const nested = assets(real(v));
    mkdirSync(join(nested, 'wasm'));
    writeFileSync(join(nested, 'wasm', 'quickjs-eval.js'), '');
    assert.ok(!shippedScripts(nested, entry.ignore).includes('wasm/quickjs-eval.js'));
    assert.ok(shippedScripts(nested, []).includes('wasm/quickjs-eval.js'));
    const dir = assets({ ...real(v), [`pdf.sandbox-${v}.min.mjs`]: 'globalThis.eval(t)' });
    assert.ok(!shippedScripts(dir, entry.ignore).some((n) => n.startsWith('pdf.sandbox-')));
    const without = entry.ignore.filter((p) => p !== '**/pdf.sandbox-*');
    assert.ok(shippedScripts(dir, without).some((n) => n.startsWith('pdf.sandbox-')));
});
