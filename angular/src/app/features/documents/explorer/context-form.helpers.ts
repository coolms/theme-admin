/**
 * F.14c-2 — pure helpers for the variable-input form. Kept Angular-
 * free so they can be unit-tested directly and so the future F.9 Form
 * Builder swap can reuse the same nested-JSON encoding.
 *
 * Three responsibilities:
 *   1. `setNestedValue` / `getNestedValue` — read & write into a
 *      `Record<string, unknown>` along a dotted path. The shape mirrors
 *      DTMPL's variable resolution (ADR-085) so the JSON the form
 *      submits is what the renderer evaluates against.
 *   2. `buildGroupTree` — fold a flat `[{path: 'customer.name'}, …]`
 *      list into a recursive group tree the template walks for fieldset
 *      rendering.
 */
import { type ContextVariableGroup, type FormVariableInput } from '../shared/document-explorer.types';

/** Value the form holds in `formData` — same shape submitted to backend. */
export type ContextFormValue = Record<string, unknown>;

/**
 * Write `value` into `target` at the dotted `path`, materialising
 * intermediate objects on the way down. Returns the same `target`
 * reference for callers that hold it; existing siblings are preserved.
 */
export function setNestedValue(
    target: ContextFormValue,
    path: string,
    value: unknown,
): ContextFormValue {
    if (path === '') {
        return target;
    }
    const segments = path.split('.');
    const last = segments.pop() as string;

    let cursor: Record<string, unknown> = target;
    for (const segment of segments) {
        const next = cursor[segment];
        if (next === undefined || next === null || typeof next !== 'object') {
            const fresh: Record<string, unknown> = {};
            cursor[segment] = fresh;
            cursor = fresh;
        } else {
            cursor = next as Record<string, unknown>;
        }
    }
    cursor[last] = value;
    return target;
}

/**
 * Read the value at `path` from `source`. Returns `undefined` when any
 * segment is missing or a non-object is encountered along the way.
 */
export function getNestedValue(source: ContextFormValue, path: string): unknown {
    if (path === '') {
        return source;
    }
    const segments = path.split('.');
    let cursor: unknown = source;
    for (const segment of segments) {
        if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
            return undefined;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
}

/**
 * Fold a flat list of variable paths into a recursive group tree.
 *
 *   ['signedAt', 'customer.name', 'customer.address.street']
 *      → [
 *          { path: '',         variables: [{path: 'signedAt'}],            subgroups: [] },
 *          { path: 'customer', variables: [{path: 'customer.name'}],
 *            subgroups: [
 *              { path: 'customer.address',
 *                variables: [{path: 'customer.address.street'}],
 *                subgroups: []
 *              }
 *            ]
 *          },
 *      ]
 *
 * Variables and groups are sorted alphabetically. The "" group only
 * appears when at least one top-level scalar exists.
 */
export function buildGroupTree(variables: readonly FormVariableInput[]): ContextVariableGroup[] {
    if (variables.length === 0) {
        return [];
    }
    const root = makeGroup('');
    for (const variable of variables) {
        insertVariable(root, variable);
    }
    return collectSorted(root);
}

interface MutableGroup {
    readonly path: string;
    variables: FormVariableInput[];
    children: Map<string, MutableGroup>;
}

function makeGroup(path: string): MutableGroup {
    return { path, variables: [], children: new Map() };
}

function insertVariable(root: MutableGroup, variable: FormVariableInput): void {
    const segments = variable.path.split('.');
    if (segments.length === 1) {
        root.variables.push(variable);
        return;
    }
    let cursor = root;
    // Walk every segment except the last — that one names the variable.
    for (let i = 0; i < segments.length - 1; i++) {
        const groupPath = segments.slice(0, i + 1).join('.');
        let child = cursor.children.get(groupPath);
        if (!child) {
            child = makeGroup(groupPath);
            cursor.children.set(groupPath, child);
        }
        cursor = child;
    }
    cursor.variables.push(variable);
}

function collectSorted(root: MutableGroup): ContextVariableGroup[] {
    const out: ContextVariableGroup[] = [];

    if (root.variables.length > 0) {
        out.push({
            path: '',
            label: '',
            variables: [...root.variables].sort(byPath),
            subgroups: [],
        });
    }

    const sortedChildren = [...root.children.values()].sort((a, b) =>
        a.path.localeCompare(b.path),
    );
    for (const child of sortedChildren) {
        out.push(toReadonly(child));
    }
    return out;
}

function toReadonly(group: MutableGroup): ContextVariableGroup {
    const sortedSubgroups = [...group.children.values()]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(toReadonly);
    return {
        path: group.path,
        label: lastSegment(group.path),
        variables: [...group.variables].sort(byPath),
        subgroups: sortedSubgroups,
    };
}

function byPath(a: FormVariableInput, b: FormVariableInput): number {
    return a.path.localeCompare(b.path);
}

/** `'customer.address'` → `'address'`; `'signedAt'` → `'signedAt'`. */
export function lastSegment(path: string): string {
    const idx = path.lastIndexOf('.');
    return idx === -1 ? path : path.slice(idx + 1);
}
