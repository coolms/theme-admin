import type { NaviGraphNode } from '@coolms/core-angular';
import type { FilterMenuOption } from '@coolms/ui-angular';

/** A list's filter as its tree serves it: its filter nodes shown in this context, and the chosen one, in its order. */
export interface TreeListFilters {
    readonly options: FilterMenuOption[];
    /** The value of the choice the tree marks the default; the first shown one's without a mark, null without choices. */
    readonly initial: string | null;
}

const metaOf = (n: NaviGraphNode): Record<string, unknown> => n.meta;

/** A node is one of the list's filters when its action is `filter` or its group is `filters`, and it names a value. */
export function isListFilter(n: NaviGraphNode): boolean {
    const meta = metaOf(n);
    return (meta['action'] === 'filter' || meta['group'] === 'filters') && typeof meta['value'] === 'string' && meta['value'] !== '';
}

/** What a page says of its list's filter nodes. */
export interface TreeListFilterRules {
    /** Whether a node is shown in this context. */
    readonly shown: (n: NaviGraphNode) => boolean;
    /** The values the page can apply: a choice of any other value is none of its choices. */
    readonly values: readonly string[];
}

/**
 * The choices: the filter nodes shown whose value the page can apply, with the one the tree marks the default and the
 * one chosen, shown or not. A tree whose marked default has a value the page cannot apply gives none: no other choice
 * is known to show every row.
 */
export function listFiltersOf(nodes: readonly NaviGraphNode[], rules: TreeListFilterRules, chosen: string | null = null): TreeListFilters {
    const valueOf = (n: NaviGraphNode): string => String(metaOf(n)['value']);
    const declared = nodes.filter(isListFilter);
    const marked = declared.find(n => metaOf(n)['default'] === true);
    if (marked !== undefined && !rules.values.includes(valueOf(marked))) return { options: [], initial: null };
    const filters = declared.filter(n => rules.values.includes(valueOf(n)));
    const offered = filters.filter(n => n === marked || rules.shown(n));
    const options = filters.filter(n => offered.includes(n) || valueOf(n) === chosen).map(n => {
        const label = metaOf(n)['label'];
        return { id: valueOf(n), label: typeof label === 'string' && label !== '' ? label : n.title };
    });
    const initial = marked ?? offered.at(0);

    return { options, initial: initial === undefined ? null : valueOf(initial) };
}

/**
 * The filter in force: the chosen one while it is one of the choices, else the default. With fewer than two choices,
 * which have no button, there is none: the list is not filtered.
 */
export function listFilterInForce(filters: TreeListFilters, chosen: string | null): string | null {
    if (filters.options.length < 2) return null;
    return chosen !== null && filters.options.some(o => o.id === chosen) ? chosen : filters.initial;
}
