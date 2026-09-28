#!/usr/bin/env node
// Views draw what they show (Dmitry, 2026-09-28: the "shows only after F5 or a keystroke" class).
//
// Two ways a value the template shows can stay stale, found in the 2026-09-28 sweep:
//
//   1. An OnPush component -- declared so, or naming no strategy, which Angular 22 renders as
//      OnPush -- writes a PLAIN field the template shows inside an asynchronous callback (a
//      subscription, a promise, a timer, a listener, the rest of an async method after an
//      await) and nothing marks the view: no markForCheck()/detectChanges(), and no write to a
//      signal the template shows. It is not drawn until something else touches the component.
//      (The sign-in page's answer, core-angular#22, was this.)
//   2. A computed()/linkedSignal() reads a plain field that changes -- written outside the
//      constructor, written by the template ([(ngModel)]="field", (event)="field = ..."), or an
//      @Input(). A computed re-runs only when a signal it read changes, so under ANY strategy it
//      keeps its first answer. (A picker's filter that did not filter was this.)
//
// The fix for both is the same: hold the value in a signal. This check reads every component the
// admin compiles -- its own src and each sibling package's (angular/tsconfig.json maps @coolms/*
// to ../../<package>/src) -- with the TypeScript parser, and reports each case by file, component
// and field. The count may only stay at zero; a case that is not one is named in EXCEPTIONS with
// the reason, and an exception that no longer matches anything is reported too.
//
// Exit: 0 CLEAR, 1 FOUND, 2 UNEVALUABLE (a package root is missing, or the parser could not be
// loaded -- could-not-look is never folded into looked-and-found-nothing).
//
// Run: npm run lint:redraw
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = resolve(ROOT, '..', '..');
const PACKAGES = ['core-angular', 'ui-angular', 'sheet-editor-angular', 'editor-angular', 'dtmpl-angular',
    'image-editor-angular', 'document-viewer-angular', 'document-angular', 'pdf-angular', 'designer'];

/**
 * Cases that are not stale, each with why. Keyed `<package>/<path from its src>#<Component>.<member>`.
 * Lower this list; never add to it without the reason the value cannot go stale.
 */
export const EXCEPTIONS = {
    'theme-admin/app/features/image-maps/image-map-regions.page.ts#ImageMapRegionsPageComponent.regionEntries':
        'reads metaVersion(), a signal bumped on every change of metaByLayer',
    'theme-admin/app/features/image-maps/image-map-regions.page.ts#ImageMapRegionsPageComponent.selectedMeta':
        'reads metaVersion(), a signal bumped on every change of metaByLayer',
    'theme-admin/app/features/vfs/vfs-tree.component.ts#VfsTreeComponent.flatNodes':
        'pathHasMore is written beside every childrenMap update, which it reads; rootPath is bound once, statically',
    'editor-angular/lib/editor.component.ts#CoolmsEditorComponent.currentPage':
        'reads stateTick(), a signal bumped on every editor transaction',
};

const ASYNC_CALLS = new Set(['subscribe', 'then', 'catch', 'finally', 'tap', 'finalize', 'setTimeout', 'setInterval',
    'requestAnimationFrame', 'queueMicrotask', 'addEventListener', 'map', 'switchMap', 'mergeMap', 'concatMap',
    'exhaustMap', 'catchError', 'listen']);
const ASYNC_NEWS = new Set(['ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'PerformanceObserver', 'Promise']);
const SIGNAL_MAKERS = new Set(['signal', 'computed', 'input', 'model', 'linkedSignal', 'toSignal', 'viewChild',
    'viewChildren', 'contentChild', 'contentChildren', 'output', 'resource', 'httpResource', 'rxResource']);
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'set', 'delete', 'clear', 'add']);

/** The analysis of one source file. `ts` is the TypeScript module; `readTemplate(url)` reads a templateUrl. */
export function analyzeSource(ts, text, fileName, readTemplate = () => '') {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const decorators = (n) => (ts.getDecorators ? ts.getDecorators(n) || [] : n.decorators || []);
    const calleeName = (call) => (ts.isIdentifier(call.expression) ? call.expression.text
        : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null);
    const isThis = (e) => e.kind === ts.SyntaxKind.ThisKeyword;
    const thisField = (e) => (ts.isPropertyAccessExpression(e) && isThis(e.expression) ? e.name.text : null);

    // `this.<name>` written: assignment (also of a field of it), ++/--, or an in-place mutation call.
    const writtenField = (node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
            for (let t = node.left; ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t); t = t.expression) {
                const f = thisField(t);
                if (f) return f;
            }
            return null;
        }
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            return thisField(node.operand);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATORS.has(node.expression.name.text)) {
            return thisField(node.expression.expression);
        }
        return null;
    };

    const findings = { components: 0, asyncWrites: [], staleComputeds: [] };
    const visit = (n) => {
        if (ts.isClassDeclaration(n)) {
            const component = decorators(n).map((d) => d.expression)
                .find((e) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'Component');
            if (component) {
                findings.components++;
                inspect(n, component.arguments[0] && ts.isObjectLiteralExpression(component.arguments[0]) ? component.arguments[0] : null);
            }
        }
        ts.forEachChild(n, visit);
    };

    const inspect = (cls, meta) => {
        const name = cls.name ? cls.name.text : '?';
        const prop = (key) => meta && meta.properties.find((p) => ts.isPropertyAssignment(p) && p.name && p.name.text === key);
        const strategyProp = prop('changeDetection');
        const strategy = strategyProp ? strategyProp.initializer.getText(sf).replace(/^ChangeDetectionStrategy\./, '') : null;
        const templateProp = prop('template');
        const urlProp = prop('templateUrl');
        const literal = (p) => (p && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))
            ? p.initializer.text : p && ts.isTemplateExpression(p.initializer) ? p.initializer.getText(sf) : null);
        const tpl = literal(templateProp) ?? (literal(urlProp) !== null ? readTemplate(literal(urlProp)) : '');

        // What a template evaluates -- never markup text or event handlers.
        const parts = [];
        for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) parts.push(m[1]);
        for (const m of tpl.matchAll(/(?:\[\(?[\w.:@-]+\)?\]|\*[\w-]+|bind-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) parts.push(m[2] ?? m[3] ?? '');
        for (const m of tpl.matchAll(/@(?:else\s+if|if|for|switch|case)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) parts.push(m[1]);
        for (const m of tpl.matchAll(/@let\s+[\w$]+\s*=\s*([^;]*);/g)) parts.push(m[1]);
        const exprs = parts.join('\n');
        const esc = (s) => s.replace(/[$]/g, '\\$');
        const named = (field) => new RegExp('(^|[^\\w$.])' + esc(field) + '(?![\\w$])').test(exprs);
        const called = (field) => new RegExp('(^|[^\\w$.])' + esc(field) + '\\s*\\(').test(exprs);

        const members = cls.members.filter((m) => m.name && ts.isIdentifier(m.name));
        const signals = new Set();
        const injected = new Set();
        for (const m of members) {
            if (!ts.isPropertyDeclaration(m)) continue;
            const init = m.initializer;
            if (init && ts.isCallExpression(init)) {
                const callee = ts.isPropertyAccessExpression(init.expression) ? init.expression.expression : init.expression;
                if (ts.isIdentifier(callee) && SIGNAL_MAKERS.has(callee.text)) signals.add(m.name.text);
                if (ts.isIdentifier(init.expression) && init.expression.text === 'inject') injected.add(m.name.text);
            }
            if (called(m.name.text)) signals.add(m.name.text); // the template calls it: a signal or a function
        }
        // Shown: named in an expression, or read as this.field by a getter/method/computed an expression names.
        const shown = (field) => {
            if (named(field)) return 'template';
            const reads = new RegExp('this\\.' + esc(field) + '(?![\\w$])');
            for (const m of members) {
                if (!named(m.name.text)) continue;
                const body = (ts.isGetAccessorDeclaration(m) || ts.isMethodDeclaration(m)) ? m.body
                    : ts.isPropertyDeclaration(m) ? m.initializer : null;
                if (body && reads.test(body.getText(sf))) return 'via ' + m.name.text;
            }
            return null;
        };
        const shownSignals = new Set([...signals].filter((s) => shown(s)));

        // 2. Stale computeds -- any strategy.
        const written = new Set();
        const walkWrites = (node, inCtor) => {
            const f = writtenField(node);
            if (f && !inCtor) written.add(f);
            ts.forEachChild(node, (c) => walkWrites(c, inCtor || ts.isConstructorDeclaration(node)));
        };
        for (const m of cls.members) {
            if (ts.isPropertyDeclaration(m)) {
                if (decorators(m).some((d) => ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
                    && d.expression.expression.text === 'Input') && m.name && ts.isIdentifier(m.name)) written.add(m.name.text);
                if (m.initializer) ts.forEachChild(m.initializer, (c) => walkWrites(c, false));
            } else {
                walkWrites(m, ts.isConstructorDeclaration(m));
            }
        }
        for (const m of tpl.matchAll(/\[\(\s*[\w.-]+\s*\)\]\s*=\s*"\s*([A-Za-z_$][\w$]*)\s*"/g)) written.add(m[1]);
        for (const ev of tpl.matchAll(/(?<!\[)\([\w.:-]+\)\s*=\s*"([^"]*)"/g)) {
            for (const w of (' ' + ev[1]).matchAll(/[^\w$.]([A-Za-z_$][\w$]*)\s*=(?!=)/g)) written.add(w[1]);
        }
        for (const m of members) {
            if (!ts.isPropertyDeclaration(m) || !m.initializer || !ts.isCallExpression(m.initializer)) continue;
            const callee = m.initializer.expression;
            if (!ts.isIdentifier(callee) || !['computed', 'linkedSignal'].includes(callee.text)) continue;
            const reads = new Set();
            const v = (x) => {
                const f = thisField(x);
                const isCall = x.parent && ts.isCallExpression(x.parent) && x.parent.expression === x;
                if (f && !isCall && !signals.has(f) && !injected.has(f) && written.has(f)) reads.add(f);
                ts.forEachChild(x, v);
            };
            v(m.initializer);
            if (reads.size) {
                findings.staleComputeds.push({ component: name, member: m.name.text, fields: [...reads], line: lineOf(m) });
            }
        }

        // 1. Unmarked async writes -- OnPush in effect only (Eager is checked on every tick).
        if (strategy === 'Eager' || strategy === 'Default') return;
        const marks = (body) => {
            let found = false;
            const v = (x) => {
                if (found) return;
                if (ts.isCallExpression(x)) {
                    const c = calleeName(x);
                    if (c === 'markForCheck' || c === 'detectChanges') found = true;
                    const e = x.expression;
                    if ((c === 'set' || c === 'update') && ts.isPropertyAccessExpression(e) && shownSignals.has(thisField(e.expression))) found = true;
                }
                ts.forEachChild(x, v);
            };
            v(body);
            return found;
        };
        const contexts = [];
        const collect = (n) => {
            if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && ASYNC_NEWS.has(n.expression.text)) {
                for (const a of n.arguments || []) if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) contexts.push({ kind: 'new ' + n.expression.text, body: a.body });
            }
            if (ts.isCallExpression(n) && ASYNC_CALLS.has(calleeName(n))) {
                for (const a of n.arguments) {
                    if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) contexts.push({ kind: calleeName(n), body: a.body });
                    if (ts.isObjectLiteralExpression(a)) {
                        for (const p of a.properties) {
                            const fn = ts.isPropertyAssignment(p) ? p.initializer : ts.isMethodDeclaration(p) ? p : null;
                            if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) && fn.body) {
                                contexts.push({ kind: calleeName(n) + '.' + p.name.getText(sf), body: fn.body });
                            }
                        }
                    }
                }
            }
            if ((ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body)
                && (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Async)) {
                let awaited = false;
                for (const st of n.body.statements) {
                    let has = false;
                    const f = (x) => { if (has) return; if (ts.isAwaitExpression(x)) has = true; else if (!ts.isFunctionLike(x)) ts.forEachChild(x, f); };
                    f(st);
                    if (awaited || has) contexts.push({ kind: 'after await', body: st });
                    awaited = awaited || has;
                }
            }
            ts.forEachChild(n, collect);
        };
        for (const m of cls.members) collect(m);
        const seen = new Map();
        for (const ctx of contexts) {
            if (marks(ctx.body)) continue;
            const v = (x) => {
                const f = writtenField(x);
                if (f && !signals.has(f) && !seen.has(f)) {
                    const where = shown(f);
                    if (where) seen.set(f, { component: name, field: f, context: ctx.kind, shown: where, line: lineOf(x) });
                }
                ts.forEachChild(x, v);
            };
            v(ctx.body);
        }
        findings.asyncWrites.push(...seen.values());
    };
    visit(sf);
    return findings;
}

function walk(dir, files = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, files);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !e.name.endsWith('.d.ts')) files.push(p);
    }
    return files;
}

async function main() {
    const roots = [['theme-admin', join(ROOT, 'src')], ...PACKAGES.map((p) => [p, join(SOURCES, p, 'src')])];
    const missing = roots.filter(([, dir]) => !existsSync(dir)).map(([p]) => p);
    let ts;
    try {
        ts = (await import('typescript')).default;
    } catch (e) {
        ts = null;
    }
    let components = 0;
    let files = 0;
    const found = [];
    const matched = new Set();
    if (ts) {
        for (const [pkg, dir] of roots.filter(([p]) => !missing.includes(p))) {
            for (const file of walk(dir)) {
                files++;
                const r = analyzeSource(ts, readFileSync(file, 'utf8'), file,
                    (url) => { try { return readFileSync(join(dirname(file), url), 'utf8'); } catch (e) { return ''; } });
                components += r.components;
                const at = pkg + '/' + relative(dir, file);
                for (const w of r.asyncWrites) {
                    found.push(`${at}:${w.line} ${w.component}.${w.field} -- written in ${w.context} and not drawn (shown: ${w.shown}); hold it in a signal`);
                }
                for (const c of r.staleComputeds) {
                    const key = `${at}#${c.component}.${c.member}`;
                    if (EXCEPTIONS[key]) { matched.add(key); continue; }
                    found.push(`${at}:${c.line} ${c.component}.${c.member} -- a computed over the plain field(s) ${c.fields.join(', ')}, which change; it keeps its first answer`);
                }
            }
        }
    }
    const read = roots.length - missing.length;
    console.log(`check-redraw: ${components} component(s) in ${files} file(s) of ${read} of ${roots.length} package(s)`);
    if (!ts) {
        console.log('  CANNOT EVALUATE: the TypeScript parser could not be loaded (npm ci in angular/)');
        process.exit(2);
    }
    if (missing.length) {
        console.log(`  CANNOT EVALUATE: not checked out beside theme-admin: ${missing.join(', ')} -- a package not read is not a package without cases`);
        process.exit(2);
    }
    const unused = Object.keys(EXCEPTIONS).filter((k) => !matched.has(k));
    for (const k of unused) found.push(`${k} -- an EXCEPTION that matches nothing any more: remove it`);
    if (found.length) {
        console.log(`  REFUSED: ${found.length} value(s) a view shows that may not be drawn:`);
        for (const f of found) console.log('    ' + f);
        process.exit(1);
    }
    console.log(`  OK -- every shown value that changes asynchronously or feeds a computed is a signal (${Object.keys(EXCEPTIONS).length} named exception(s), each with its reason)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
