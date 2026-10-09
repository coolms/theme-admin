import type { ContextSchemaVariable } from '../shared/document-explorer.types';
import { SERVER_FILLED_ROOTS } from '../explorer/template-variables.helpers';

/**
 * The paths a caller may fill: the variables the template's author switched on as "Filled by the caller", each
 * once, in the order they first appear. The server takes a value at no other path (400), and it reads a stored
 * schema the same way whatever the schema says, so none of these is ever one, even when an entry marks it:
 * - a path under a root the server fills ({@link SERVER_FILLED_ROOTS});
 * - an entity reference's path, or a path under it, when any entry of that path names an `entityType`: the
 *   reference's id comes from the generation's audience, which the server checks when it is submitted.
 */
export function callerFillablePaths(variables: readonly ContextSchemaVariable[]): string[] {
    const references = variables.filter(isReference).map(v => v.path);
    const paths: string[] = [];
    for (const v of variables) {
        if (true !== v.callerFillable || paths.includes(v.path)) {
            continue;
        }
        if (SERVER_FILLED_ROOTS.includes(v.path.split('.', 1)[0])) {
            continue;
        }
        if (references.some(r => v.path === r || v.path.startsWith(`${r}.`))) {
            continue;
        }
        paths.push(v.path);
    }
    return paths;
}

function isReference(variable: ContextSchemaVariable): boolean {
    return typeof variable.entityType === 'string' && '' !== variable.entityType;
}

/**
 * The values the wizard sends: only those at a fillable path, as plain values. A draft saved before the author
 * switched a variable off, or before this filter existed, may still hold others; they are dropped here rather than
 * refused by the server. Objects are kept only where a fillable path continues below them, and an object left empty
 * is dropped too.
 */
export function onlyCallerFillable(values: Record<string, unknown>, paths: readonly string[]): Record<string, unknown> {
    const keep = (prefix: string, node: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
            const path = prefix === '' ? key : `${prefix}.${key}`;
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                if (paths.some(p => p.startsWith(`${path}.`))) {
                    const child = keep(path, value as Record<string, unknown>);
                    if (Object.keys(child).length > 0) {
                        out[key] = child;
                    }
                }
                continue;
            }
            if (!Array.isArray(value) && paths.includes(path)) {
                out[key] = value;
            }
        }
        return out;
    };
    return keep('', values);
}
