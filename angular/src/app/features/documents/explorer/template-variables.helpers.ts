import { type ContextSchema, type ContextSchemaVariable } from '../shared/document-explorer.types';

/**
 * The first path segments the server fills, so no caller ever may. The server keeps the same list and refuses a save
 * that marks one, so this copy decides only what the panel offers: if the two ever drift, the save is refused and says
 * which variable, rather than a wrong mark being stored.
 */
export const SERVER_FILLED_ROOTS: readonly string[] = [
    'metadata',
    'audienceEntityId',
    'audienceEntityType',
    '_const',
    '_schema',
];

/** One input of a template: a path, however many times the text uses it. */
export interface TemplateVariableRow {
    readonly path: string;
    readonly filters: readonly string[];
    readonly loopAlias: string | null;
    readonly callerFillable: boolean;
    /** Why the switch is not offered, or `null` when it is. */
    readonly lockedReason: string | null;
}

/**
 * The schema's variables as one row per path, in the order the text first uses them. The filters of every use are
 * listed together, and a path counts as filled by the caller when any of its entries is marked.
 */
export function variableRows(schema: ContextSchema | null): TemplateVariableRow[] {
    const rows = new Map<string, { filters: string[]; loopAlias: string | null; marked: boolean; reference: boolean }>();
    for (const variable of schema?.variables ?? []) {
        const row = rows.get(variable.path) ?? {
            filters: [],
            loopAlias: variable.loopAlias,
            marked: false,
            reference: false,
        };
        for (const filter of variable.filters) {
            if (!row.filters.includes(filter)) {
                row.filters.push(filter);
            }
        }
        row.marked ||= true === variable.callerFillable;
        row.reference ||= isReference(variable);
        rows.set(variable.path, row);
    }

    return [...rows].map(([path, row]) => ({
        path,
        filters: row.filters,
        loopAlias: row.loopAlias,
        callerFillable: row.marked,
        lockedReason: lockedReason(path, row.reference),
    }));
}

/**
 * The schema with the "Filled by the caller" switch of one path set: every entry of the path changes together, and
 * an entry switched off carries no `callerFillable` key at all, as the server writes it.
 */
export function withCallerFillable(schema: ContextSchema, path: string, on: boolean): ContextSchema {
    return {
        ...schema,
        variables: schema.variables.map((variable) => {
            if (variable.path !== path) {
                return variable;
            }
            const { callerFillable: _previous, ...rest } = variable;

            return on ? { ...rest, callerFillable: true } : rest;
        }),
    };
}

function isReference(variable: ContextSchemaVariable): boolean {
    return typeof variable.entityType === 'string' && '' !== variable.entityType;
}

function lockedReason(path: string, reference: boolean): string | null {
    if (reference) {
        return 'A record: the server checks that the caller may read it.';
    }
    if (SERVER_FILLED_ROOTS.includes(path.split('.', 1)[0])) {
        return 'Filled by the server.';
    }

    return null;
}
