import type { NaviGraphNode } from '@coolms/core-angular';
import type { FilterChipOption } from '@coolms/ui-angular';

/** The value of the filter that keeps every conversation, and the one that keeps the unread. */
export const ALL_CONVERSATIONS = 'all';
export const UNREAD_CONVERSATIONS = 'unread';

/** The list's filter chips as the tree serves them: its filter nodes shown in this context, in its order. */
export interface ConversationFilters {
    readonly options: FilterChipOption[];
    /** The value of the node the tree marks the default; the first chip's without one, null without chips. */
    readonly initial: string | null;
}

/** A node is one of the list's filters when its action is `filter` or its group is `filters`, and it names a value. */
function isFilter(n: NaviGraphNode): boolean {
    const meta = n.meta as Record<string, unknown>;
    return (meta['action'] === 'filter' || meta['group'] === 'filters') && typeof meta['value'] === 'string' && meta['value'] !== '';
}

export function conversationFiltersOf(nodes: readonly NaviGraphNode[], shown: (n: NaviGraphNode) => boolean): ConversationFilters {
    const kept = nodes.filter(n => isFilter(n) && shown(n));
    const options = kept.map(n => {
        const meta = n.meta as Record<string, unknown>;
        const label = typeof meta['label'] === 'string' && meta['label'] !== '' ? meta['label'] : n.title;
        return { id: String(meta['value']), label };
    });
    const marked = kept.find(n => (n.meta as Record<string, unknown>)['default'] === true);

    return { options, initial: marked !== undefined ? String((marked.meta as Record<string, unknown>)['value']) : (options[0]?.id ?? null) };
}

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
