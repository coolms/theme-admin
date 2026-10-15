#!/usr/bin/env node
/**
 * The admin suite's specs, counted by the repository they come from (src/spec-origin/record.ts writes them to the
 * browser console as `SPECS BY REPOSITORY {...}` when the run ends), held against `spec-floors.json`: the fewest
 * specs each repository is known to run. A repository below its floor is a drop -- specs that stopped running while
 * the suite stayed green, which the total alone hid twice. Lower a floor only when specs were removed on purpose.
 *
 * Usage: node scripts/check-spec-floors.mjs <karma log>
 * Three answers: exit 0 CLEAR (every repository at or above its floor), 1 FOUND (a drop, or a repository with no
 * count), 2 UNEVALUABLE (no count line in the log -- the run did not report, which is never read as clear).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const logPath = process.argv[2];
if (!logPath) {
    console.error('usage: node scripts/check-spec-floors.mjs <karma log>');
    process.exit(2);
}
const log = readFileSync(logPath, 'utf8').replace(/\r/gu, '\n');
const line = [...log.matchAll(/SPECS BY REPOSITORY (\{[^\n']*\})/gu)].pop();
if (!line) {
    console.error('UNEVALUABLE: the run wrote no "SPECS BY REPOSITORY" line -- nothing counted, nothing compared');
    process.exit(2);
}
const counts = JSON.parse(line[1]);
const floors = JSON.parse(readFileSync(join(HERE, '..', 'spec-floors.json'), 'utf8'));

const rows = [];
const drops = [];
for (const repository of [...new Set([...Object.keys(floors), ...Object.keys(counts)])].sort()) {
    const ran = counts[repository]?.executed ?? 0;
    const floor = floors[repository] ?? null;
    rows.push(`  ${repository.padEnd(22)} ${String(ran).padStart(5)} executed`
        + `, ${counts[repository]?.failed ?? 0} failed, ${counts[repository]?.skipped ?? 0} skipped`
        + (floor === null ? '  (no floor yet)' : `  (floor ${floor})`));
    if (floor !== null && ran < floor) {
        drops.push(`${repository} ran ${ran}, below its floor ${floor}`);
    }
}
console.log('Specs by repository:\n' + rows.join('\n'));
if (drops.length) {
    console.error('FOUND: ' + drops.join('; '));
    process.exit(1);
}
console.log('CLEAR: every repository ran at least its floor');
