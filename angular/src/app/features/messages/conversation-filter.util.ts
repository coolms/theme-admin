/** The value of the filter that keeps every conversation, and the one that keeps the unread. */
export const ALL_CONVERSATIONS = 'all';
export const UNREAD_CONVERSATIONS = 'unread';

/** The values the list can apply: every one, the unread, and each kind of conversation. */
export const CONVERSATION_FILTER_VALUES: readonly string[] = [
    ALL_CONVERSATIONS, UNREAD_CONVERSATIONS, 'direct', 'group', 'dynamic_chat', 'internal', 'self_notes',
];

/**
 * The conversations a filter value keeps, in their order: `all` every one, `unread` those the reader has unread, any
 * other value those of that kind (`direct`, `group`, ...). Null keeps every one.
 */
export function conversationsShown<T extends { readonly kind: string }>(
    rows: readonly T[], value: string | null, unread: (row: T) => boolean,
): T[] {
    if (value === null || value === ALL_CONVERSATIONS) return [...rows];
    if (value === UNREAD_CONVERSATIONS) return rows.filter(unread);
    return rows.filter(c => c.kind === value);
}
