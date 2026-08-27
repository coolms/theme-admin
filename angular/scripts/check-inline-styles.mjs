#!/usr/bin/env node
// Guard on the two ways an inline `styles`/`template` block silently stops
// being what it looks like.
//
// ── 1. A BACKTICK inside the literal ─────────────────────────────────────────
// Component styles live in a template literal, so a backtick written in a CSS
// comment — the natural way to quote a class name in prose — ENDS the literal.
// The CSS after it is parsed as TypeScript, where `#2030` becomes a private
// identifier and `--cms-btn` becomes a double negation, and the error surfaces
// far away as "Failed to resolve styles at position 0 to a string".
//
// Counting backticks does NOT catch this, which is the trap: quoting a name
// puts them in PAIRS, so parity stays even while the literal has been closed
// and reopened around the wrong text. Only the parse tells the truth, so this
// asks TypeScript rather than a regex.
//
// ── 2. A `//` COMMENT inside the literal ─────────────────────────────────────
// This project sets no `inlineStyleLanguage`, so Angular parses inline styles
// as plain CSS, where `//` is not a comment. Use /* */.
//
// Run: npm run lint:styles
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* walk(path);
        else if (entry.endsWith('.ts')) yield path;
    }
}

const isStaticString = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

/**
 * Property assignments inside an actual `@Component({...})`, and nothing else.
 *
 * Scoping matters: a first version matched ANY property named `styles` or
 * `template` and reported 15 false positives — a `template` column in a spec
 * fixture, a `template` field built by string concatenation in page.service.ts.
 * Those are ordinary properties allowed to be any expression, and flagging them
 * would have trained the reader to ignore this check.
 */
function componentMetadata(sf) {
    const props = [];
    const collect = node => {
        if (ts.isClassDeclaration(node)) {
            for (const dec of ts.getDecorators?.(node) ?? []) {
                if (!ts.isCallExpression(dec.expression)) continue;
                if (dec.expression.expression.getText() !== 'Component') continue;
                const arg = dec.expression.arguments[0];
                if (arg && ts.isObjectLiteralExpression(arg)) {
                    for (const prop of arg.properties) {
                        if (ts.isPropertyAssignment(prop)) props.push(prop);
                    }
                }
            }
        }
        ts.forEachChild(node, collect);
    };
    collect(sf);

    return props;
}

const problems = [];

for (const file of walk(SRC)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const where = node => relative(ROOT, file) + ':' + (sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);

    for (const node of componentMetadata(sf)) {
        const name = node.name.getText();
        if (name !== 'styles' && name !== 'template') continue;

        const init = node.initializer;
        const isArray = ts.isArrayLiteralExpression(init);
        const elements = isArray ? init.elements : [init];

        elements.forEach((el, i) => {
            if (!isStaticString(el)) {
                problems.push(
                    `${where(node)}  ${name}${isArray ? `[${i}]` : ''} is ${ts.SyntaxKind[el.kind]}, `
                    + 'not a plain literal — almost always a stray backtick inside the block '
                    + '(a quoted class name in a comment).',
                );

                return;
            }

            if (name !== 'styles') return;

            // `//` at the start of a line. Anchored so `https://` in a url() cannot match.
            el.getText().split('\n').forEach((line, n) => {
                if (/^\s*\/\//.test(line)) {
                    problems.push(
                        `${where(node)} (+${n})  \`//\` comment inside inline styles — this project `
                        + 'parses them as CSS, where that is not a comment. Use /* */.',
                    );
                }
            });
        });
    }
}

if (problems.length) {
    console.error(`\n✗ Inline style/template blocks: ${problems.length} problem(s).\n`);
    problems.forEach(p => console.error('  ' + p));
    console.error('');
    process.exit(1);
}

console.log('✓ Inline style/template blocks: all static, no `//` comments.');
