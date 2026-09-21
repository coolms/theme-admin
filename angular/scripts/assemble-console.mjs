/**
 * Assemble the console registry from the modules' entry files.
 *
 * The build-time half of `console@1` (ADR-194, decision 6). Every module that
 * contributes to the administration console exports one entry,
 * `src/app/features/<feature>/entries/console.ts` (or `console.<qualifier>.ts`
 * when one feature directory serves two backend modules), and this script
 * collects them into `src/app/console.registry.ts`, which app.config.ts and
 * app.routes.ts read. The registry is generated on `prebuild` and `pretest`
 * and is not tracked: the list is DISCOVERED from the files, never maintained
 * by hand, which is the point.
 *
 * It refuses, by name, before writing anything:
 *   - a theme.yaml whose `contracts.console` differs from the version
 *     core-angular's contract declares (the theme's declaration is READ here,
 *     not merely stored);
 *   - an entry whose `range` this contract version does not satisfy;
 *   - an entry naming a module with no `config/modules/<id>` directory;
 *   - two entries for one module.
 * Collisions between entries (paths, binding names, ids, ports) need the
 * entries evaluated, and are refused by `assembleConsole()` in core-angular,
 * which the suite runs over the generated registry and the bootstrap runs
 * again.
 *
 * Run: node scripts/assemble-console.mjs [--check] [--root DIR] [--theme FILE]
 *      [--contract FILE] [--modules-dir DIR] [--out FILE]
 * Exit 0 with the registry written (or unchanged), 1 with the refusals listed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const ROOT        = resolve(opt('--root', join(here, '..')));
const THEME       = resolve(opt('--theme', join(ROOT, '..', 'theme.yaml')));
const CONTRACT    = resolve(opt('--contract', join(ROOT, '..', '..', 'core-angular', 'src', 'contracts', 'console', 'console-v1.ts')));
const MODULES_DIR = opt('--modules-dir', join(ROOT, '..', '..', '..', 'config', 'modules'));
const OUT         = resolve(opt('--out', join(ROOT, 'src', 'app', 'console.registry.ts')));
const CHECK_ONLY  = args.includes('--check');
const FEATURES    = join(ROOT, 'src', 'app', 'features');

const VERSION = /^(\d+)\.(\d+)$/;
const RANGE   = /^\^(\d+)\.(\d+)$/;
const satisfies = (range, version) => {
    const r = RANGE.exec(range);
    const v = VERSION.exec(version);
    return !!r && !!v && Number(r[1]) === Number(v[1]) && Number(v[2]) >= Number(r[2]);
};

const problems = [];

// -- the contract this build compiles against ---------------------------------
if (!existsSync(CONTRACT)) {
    problems.push(`the console contract is not at ${CONTRACT}`);
}
const contractSrc = existsSync(CONTRACT) ? readFileSync(CONTRACT, 'utf8') : '';
const contractVersion = /name:\s*'console',\s*version:\s*'(\d+\.\d+)'/.exec(contractSrc)?.[1] ?? null;
if (existsSync(CONTRACT) && !contractVersion) {
    problems.push(`${relative(ROOT, CONTRACT)} declares no CONSOLE_CONTRACT version`);
}

// -- the theme's declaration -----------------------------------------------------
let themeSlug = '?';
let themeVersion = null;
if (!existsSync(THEME)) {
    problems.push(`no theme manifest at ${THEME}`);
} else {
    const theme = yaml.load(readFileSync(THEME, 'utf8')) ?? {};
    themeSlug = String(theme.slug ?? '?');
    const declared = theme.contracts?.console;
    if (declared === undefined) {
        problems.push(`theme '${themeSlug}' declares no console contract (theme.yaml: contracts.console) -- a host that reads no declaration is what ADR-194 forbids`);
    } else if (!VERSION.test(String(declared))) {
        problems.push(`theme '${themeSlug}' declares console '${String(declared)}'; a contract version is MAJOR.MINOR`);
    } else {
        themeVersion = String(declared);
        if (contractVersion && themeVersion !== contractVersion) {
            problems.push(`theme '${themeSlug}' declares console ${themeVersion}; the core-angular it compiles against implements console ${contractVersion} -- refused`);
        }
    }
}

// -- the entries -----------------------------------------------------------------
const entryFiles = [];
if (existsSync(FEATURES)) {
    for (const feature of readdirSync(FEATURES).sort()) {
        const dir = join(FEATURES, feature, 'entries');
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
        // console.ts first (the feature's own module), then the qualified ones in name order.
        const files = readdirSync(dir).filter((f) => /^console(\.[a-z0-9-]+)?\.ts$/.test(f))
            .sort((a, b) => (a === 'console.ts' ? -1 : b === 'console.ts' ? 1 : a.localeCompare(b)));
        for (const f of files) entryFiles.push({ feature, file: join(dir, f) });
    }
}

const entries = [];
const byModule = new Map();
for (const { feature, file } of entryFiles) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const module = /\bmodule:\s*'([^']+)'/.exec(src)?.[1];
    const range = /\brange:\s*'([^']+)'/.exec(src)?.[1];
    const contract = /\bcontract:\s*'([^']+)'/.exec(src)?.[1];
    if (!module) { problems.push(`${rel}: no module id (module: '<id>' as a literal)`); continue; }
    if (contract !== 'console') { problems.push(`${rel}: contract is '${contract ?? ''}', this registry is console`); continue; }
    if (!range) { problems.push(`${rel}: no range (range: '^MAJOR.MINOR' as a literal)`); continue; }
    if (contractVersion && !satisfies(range, contractVersion)) {
        problems.push(`module '${module}' (${rel}) offers console ${range}; this host implements console ${contractVersion} -- refused`);
    }
    if (MODULES_DIR && existsSync(MODULES_DIR) && !existsSync(join(MODULES_DIR, module))) {
        problems.push(`module '${module}' (${rel}) has no ${relative(ROOT, join(MODULES_DIR, module))} -- an entry names a backend module`);
    }
    const prev = byModule.get(module);
    if (prev) problems.push(`module '${module}' has two entries: ${prev} and ${rel}`);
    else byModule.set(module, rel);
    const ident = 'entry_' + relative(FEATURES, file).replace(/\.ts$/, '').replace(/[^A-Za-z0-9]+/g, '_');
    entries.push({ module, range, ident, importPath: './' + relative(join(ROOT, 'src', 'app'), file).replace(/\\/g, '/').replace(/\.ts$/, '') });
}

if (problems.length) {
    console.error('assemble-console: REFUSED');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
}

// -- the registry ------------------------------------------------------------------
const lines = [
    `// GENERATED by scripts/assemble-console.mjs from ${entries.length} entry file${entries.length === 1 ? '' : 's'} -- do not edit; not tracked.`,
    `// Theme '${themeSlug}' implements console ${themeVersion}; core-angular declares console ${contractVersion}.`,
    `import type { ConsoleEntry } from '@coolms/core-angular';`,
    ...entries.map(e => `import ${e.ident} from '${e.importPath}';`),
    ``,
    `export const CONSOLE_ENTRIES: readonly ConsoleEntry[] = [${entries.map(e => e.ident).join(', ')}];`,
    `export const CONSOLE_BUILT = { contract: 'console', version: '${contractVersion}', theme: '${themeSlug}', entries: ${entries.length} } as const;`,
    ``,
];
const content = lines.join('\n');
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
if (!CHECK_ONLY && current !== content) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, content);
}
const modules = entries.map(e => `${e.module} ${e.range}`).join(', ');
console.log(`assemble-console: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${entries.length ? ` (${modules})` : " -- the six lists are the shell's own"}; theme '${themeSlug}' implements console ${themeVersion} = core-angular ${contractVersion}; ${CHECK_ONLY ? 'check only' : current === content ? 'registry unchanged' : 'registry written'}: ${relative(ROOT, OUT)}`);
