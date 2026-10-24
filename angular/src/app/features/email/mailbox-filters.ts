/**
 * A mailbox's filters (stored as mailbox rules): the API's shapes, the vocabulary the editor offers, and the rules a
 * filter must keep -- the contract of `GET|POST|PATCH|DELETE /email/mailboxes/{mailboxId}/rules` (2026-10-24).
 *
 * A filter runs on mail that arrives in the mailbox's INBOX, after the mail server's own filters, and its actions are
 * written back to the server. The checks here are the contract's, so a person sees a mistake before the server
 * refuses it; the server's 422 stays the authority, and its violations land on the same fields
 * ({@link violationsByPath}).
 */

export type FilterMatch = 'all' | 'any';

export type FilterField = 'from' | 'to' | 'cc' | 'replyTo' | 'subject' | 'body' | 'header' | 'hasAttachment' | 'size';

export type FilterOperator =
    | 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith'
    | 'exists' | 'is' | 'greaterThan' | 'lessThan';

export interface FilterCondition {
    readonly field: FilterField;
    readonly operator: FilterOperator;
    /** A string, a boolean for `hasAttachment`, a byte count for `size`; absent for `exists`. */
    readonly value?: string | boolean | number;
    /** The header's name, for `field: 'header'` only. */
    readonly name?: string;
}

export type FilterActionType = 'move' | 'trash' | 'markRead' | 'flag' | 'addLabel';

export interface FilterAction {
    readonly type: FilterActionType;
    /** The folder, for `move`. */
    readonly folder?: string;
    /** The label, for `addLabel`. */
    readonly label?: string;
}

/** A filter as the API answers it. */
export interface MailboxFilter {
    readonly id: string;
    readonly mailboxId: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly position: number;
    readonly match: FilterMatch;
    readonly conditions: readonly FilterCondition[];
    readonly actions: readonly FilterAction[];
    readonly stopProcessing: boolean;
    readonly lastMatchedAt: string | null;
    readonly matchCount: number;
    readonly lastError: string | null;
}

/** The writable part of a filter: what POST takes, and what a PATCH may name. */
export interface MailboxFilterWrite {
    name: string;
    enabled: boolean;
    match: FilterMatch;
    conditions: FilterCondition[];
    actions: FilterAction[];
    stopProcessing: boolean;
}

/** A folder a filter may move mail to, as the server lists it (`GET .../rules/folders`). */
export interface FilterFolder {
    /** The full name with the server's delimiter ("INBOX/Accounts", "[Gmail]/Trash"), sent back unchanged. */
    readonly folder: string;
    readonly role?: string | null;
    readonly selectable?: boolean;
}

export const MAX_CONDITIONS = 20;
export const MAX_ACTIONS = 5;
export const MAX_FILTERS = 100;
export const MAX_NAME = 120;

const TEXT_OPERATORS: readonly FilterOperator[] = ['contains', 'notContains', 'equals', 'startsWith', 'endsWith'];

/** Each field, in the order the editor offers them, with its words and its operators. */
export const FILTER_FIELDS: readonly { readonly field: FilterField; readonly label: string; readonly operators: readonly FilterOperator[] }[] = [
    { field: 'from', label: 'From', operators: TEXT_OPERATORS },
    { field: 'to', label: 'To', operators: TEXT_OPERATORS },
    { field: 'cc', label: 'Cc', operators: TEXT_OPERATORS },
    { field: 'replyTo', label: 'Reply-To', operators: TEXT_OPERATORS },
    { field: 'subject', label: 'Subject', operators: TEXT_OPERATORS },
    { field: 'body', label: 'Body', operators: ['contains', 'notContains'] },
    { field: 'header', label: 'Header', operators: [...TEXT_OPERATORS, 'exists'] },
    { field: 'hasAttachment', label: 'Has an attachment', operators: ['is'] },
    { field: 'size', label: 'Size', operators: ['greaterThan', 'lessThan'] },
];

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
    contains: 'contains',
    notContains: 'does not contain',
    equals: 'is',
    startsWith: 'starts with',
    endsWith: 'ends with',
    exists: 'is present',
    is: 'is',
    greaterThan: 'is larger than',
    lessThan: 'is smaller than',
};

/** The actions the editor offers. `addLabel` is held back: the server refuses it until its IMAP library can. */
export const FILTER_ACTIONS: readonly { readonly type: FilterActionType; readonly label: string }[] = [
    { type: 'move', label: 'Move to folder' },
    { type: 'trash', label: 'Move to Trash' },
    { type: 'markRead', label: 'Mark as read' },
    { type: 'flag', label: 'Flag' },
];

export function operatorsFor(field: FilterField): readonly FilterOperator[] {
    return FILTER_FIELDS.find(f => f.field === field)?.operators ?? TEXT_OPERATORS;
}

export function fieldLabel(field: FilterField): string {
    return FILTER_FIELDS.find(f => f.field === field)?.label ?? field;
}

/** A new condition for `field`, with that field's first operator and an empty value of its kind. */
export function newCondition(field: FilterField = 'from'): FilterCondition {
    const operator = operatorsFor(field)[0];
    if (field === 'hasAttachment') return { field, operator, value: true };
    if (field === 'size') return { field, operator, value: 1048576 };
    if (field === 'header') return { field, operator, name: '', value: '' };
    return { field, operator, value: '' };
}

/** A blank filter, as the editor opens it. */
export function newFilter(): MailboxFilterWrite {
    return { name: '', enabled: true, match: 'all', conditions: [newCondition()], actions: [{ type: 'markRead' }], stopProcessing: false };
}

/** The writable part of a filter the API answered, copied so the editor's changes never touch the list's. */
export function toWrite(f: MailboxFilter): MailboxFilterWrite {
    return {
        name: f.name,
        enabled: f.enabled,
        match: f.match,
        conditions: f.conditions.map(c => ({ ...c })),
        actions: f.actions.map(a => ({ ...a })),
        stopProcessing: f.stopProcessing,
    };
}

/** A condition with only the keys its field and operator use: a field changed in the editor leaves nothing behind. */
export function cleanCondition(c: FilterCondition): FilterCondition {
    const base = { field: c.field, operator: c.operator };
    const withName = c.field === 'header' ? { ...base, name: (c.name ?? '').trim() } : base;
    if (c.operator === 'exists') return withName;
    if (c.field === 'hasAttachment') return { ...withName, value: c.value === true || c.value === 'true' };
    if (c.field === 'size') return { ...withName, value: Number(c.value) };
    return { ...withName, value: String(c.value ?? '').trim() };
}

export function cleanAction(a: FilterAction): FilterAction {
    if (a.type === 'move') return { type: 'move', folder: (a.folder ?? '').trim() };
    if (a.type === 'addLabel') return { type: 'addLabel', label: (a.label ?? '').trim() };
    return { type: a.type };
}

/** The body POST or a full PATCH sends: every writable field, each condition and action with only its own keys. */
export function toPayload(w: MailboxFilterWrite): MailboxFilterWrite {
    return {
        name: w.name.trim(),
        enabled: w.enabled,
        match: w.match,
        conditions: w.conditions.map(cleanCondition),
        actions: w.actions.map(cleanAction),
        stopProcessing: w.stopProcessing,
    };
}

/**
 * The contract's rules, as messages keyed by the server's own `propertyPath` (`name`, `conditions[1].value`,
 * `actions`), so the client's and the server's land in the same place. Empty when the filter may be saved.
 */
export function validateFilter(w: MailboxFilterWrite): Record<string, string> {
    const errors: Record<string, string> = {};
    const name = w.name.trim();
    if (name === '') errors['name'] = 'Name the filter.';
    else if (name.length > MAX_NAME) errors['name'] = `At most ${MAX_NAME} characters.`;

    if (w.conditions.length === 0) errors['conditions'] = 'Add at least one condition.';
    else if (w.conditions.length > MAX_CONDITIONS) errors['conditions'] = `At most ${MAX_CONDITIONS} conditions.`;
    w.conditions.forEach((raw, i) => {
        const c = cleanCondition(raw);
        if (!operatorsFor(c.field).includes(c.operator)) errors[`conditions[${i}].operator`] = 'Not an operator for this field.';
        if (c.field === 'header' && !c.name) errors[`conditions[${i}].name`] = 'Name the header.';
        if (c.operator === 'exists' || c.field === 'hasAttachment') return;
        if (c.field === 'size') {
            if (!Number.isInteger(c.value) || (c.value as number) < 0) errors[`conditions[${i}].value`] = 'A whole number of bytes.';
        } else if (c.value === '') {
            errors[`conditions[${i}].value`] = 'Enter what to look for.';
        }
    });

    if (w.actions.length === 0) errors['actions'] = 'Add at least one action.';
    else if (w.actions.length > MAX_ACTIONS) errors['actions'] = `At most ${MAX_ACTIONS} actions.`;
    else if (w.actions.filter(a => a.type === 'move' || a.type === 'trash').length > 1) {
        errors['actions'] = 'A filter moves a message once: keep one of Move to folder and Move to Trash.';
    }
    w.actions.forEach((a, i) => {
        if (a.type === 'move' && !(a.folder ?? '').trim()) errors[`actions[${i}].folder`] = 'Choose the folder.';
    });
    return errors;
}

/** A 422's violations as messages keyed by `propertyPath`; empty for any other error. */
export function violationsByPath(err: unknown): Record<string, string> {
    const e = err as { status?: number; error?: { violations?: { propertyPath?: string; message?: string }[] } } | null;
    if (e?.status !== 422 || !Array.isArray(e.error?.violations)) return {};
    const out: Record<string, string> = {};
    for (const v of e.error.violations) {
        const path = v.propertyPath ?? '';
        if (!(path in out)) out[path] = v.message ?? 'Not accepted.';
    }
    return out;
}

function describeCondition(c: FilterCondition): string {
    const subject = c.field === 'header' ? `Header ${c.name || '?'}` : fieldLabel(c.field);
    if (c.operator === 'exists') return `${subject} is present`;
    if (c.field === 'hasAttachment') return c.value === false || c.value === 'false' ? 'No attachment' : 'Has an attachment';
    if (c.field === 'size') return `Size ${OPERATOR_LABELS[c.operator]} ${formatBytes(Number(c.value))}`;
    return `${subject} ${OPERATOR_LABELS[c.operator]} "${String(c.value ?? '')}"`;
}

function describeAction(a: FilterAction): string {
    if (a.type === 'move') return `move to ${a.folder || '?'}`;
    if (a.type === 'trash') return 'move to Trash';
    if (a.type === 'markRead') return 'mark as read';
    if (a.type === 'flag') return 'flag';
    return `label ${a.label || '?'}`;
}

/** One line for the list: "If From contains "billing@" and Subject contains "invoice": move to Accounts, mark as read." */
export function summarizeFilter(f: {
    readonly match: FilterMatch;
    readonly conditions: readonly FilterCondition[];
    readonly actions: readonly FilterAction[];
    readonly stopProcessing: boolean;
}): string {
    const joiner = f.match === 'all' ? ' and ' : ' or ';
    const when = f.conditions.map(describeCondition).join(joiner);
    const then = f.actions.map(describeAction).join(', ');
    const stop = f.stopProcessing ? '; no later filter' : '';
    return `If ${when}: ${then}${stop}.`;
}

export function formatBytes(n: number): string {
    if (!Number.isFinite(n)) return '?';
    if (n >= 1048576) return `${+(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${+(n / 1024).toFixed(1)} KB`;
    return `${n} bytes`;
}

/** The ids in the order the list shows after moving `id` one place up (-1) or down (+1); null at either end. */
export function moved(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
    const i = ids.indexOf(id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const out = [...ids];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}
