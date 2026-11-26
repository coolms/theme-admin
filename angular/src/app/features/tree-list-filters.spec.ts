import type { NaviGraphNode } from '@coolms/core-angular';

import { isListFilter, listFilterInForce, listFiltersOf } from './tree-list-filters';

const node = (path: string, meta: Record<string, unknown>, title = ''): NaviGraphNode => ({
    id: 'n' + path, path, title, parentId: null, sortOrder: 0, isActive: true, isVisible: true, children: [], meta,
}) as unknown as NaviGraphNode;
const TREE: NaviGraphNode[] = [
    node('/refresh', { action: 'refresh', group: 'list' }),
    node('/filter-direct', { label: 'Direct', action: 'filter', value: 'direct' }),
    node('/filter-all', { label: 'All', action: 'filter', value: 'all', default: true }),
    node('/filter-groups', { group: 'filters', value: 'group' }, 'Groups'),
    node('/filter-unread', { label: 'Unread', action: 'filter', value: 'unread', hidden: true }),
];
const shown = (n: NaviGraphNode): boolean => (n.meta as Record<string, unknown>)['hidden'] !== true;
const RULES = { shown, values: ['all', 'direct', 'group', 'unread'] };

describe('listFiltersOf', () => {
    it('the choices are the filter nodes shown, in the tree\'s order, by their label or title; the default is the one marked', () => {
        const { options, initial } = listFiltersOf(TREE, RULES);
        expect(options).toEqual([{ id: 'direct', label: 'Direct' }, { id: 'all', label: 'All' }, { id: 'group', label: 'Groups' }]);
        expect(initial).toBe('all');
    });

    it('without a mark the default is the first shown, not the first declared; without filter nodes there is none', () => {
        expect(listFiltersOf(TREE.filter(n => n.path !== '/filter-all'), RULES).initial).toBe('direct');
        expect(listFiltersOf([TREE[4], TREE[1], TREE[3]], RULES).initial).toBe('direct');
        expect(listFiltersOf([TREE[0]], RULES)).toEqual({ options: [], initial: null });
        expect(listFiltersOf([], RULES)).toEqual({ options: [], initial: null });
    });

    it('the chosen one stays in its place while it is chosen, shown or not; a value of no filter adds none', () => {
        const labels = (chosen: string | null) => listFiltersOf(TREE, RULES, chosen).options.map(o => o.label);
        expect(labels('unread')).toEqual(['Direct', 'All', 'Groups', 'Unread']);
        expect(labels('gone')).toEqual(['Direct', 'All', 'Groups']);
        expect(labels(null)).toEqual(['Direct', 'All', 'Groups']);
    });

    it('the marked default is a choice and the default, shown or not', () => {
        const hiddenAll = node('/filter-all', { label: 'All', action: 'filter', value: 'all', default: true, hidden: true });
        const unread = node('/filter-unread', { label: 'Unread', action: 'filter', value: 'unread' });
        const filters = listFiltersOf([unread, hiddenAll], RULES);
        expect(filters).toEqual({ options: [{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }], initial: 'all' });
        expect(listFilterInForce(filters, null)).withContext('not filtered from the start').toBe('all');
        expect(listFilterInForce(filters, 'unread')).toBe('unread');
    });

    it('a marked default whose value the page cannot apply: no choices, and no other is the default', () => {
        const odd = node('/filter-odd', { label: 'Odd', action: 'filter', value: 'odd', default: true });
        const filters = listFiltersOf([odd, ...TREE.filter(n => n.path !== '/filter-all')], RULES, 'direct');
        expect(filters).toEqual({ options: [], initial: null });
        expect(listFilterInForce(filters, 'direct')).toBeNull();
    });

    it('a choice whose value the page cannot apply is none of its choices, chosen or not', () => {
        const odd = node('/filter-odd', { label: 'Odd', action: 'filter', value: 'odd' });
        const { options, initial } = listFiltersOf([odd, ...TREE], RULES, 'odd');
        expect(options.map(o => o.id)).toEqual(['direct', 'all', 'group']);
        expect(initial).toBe('all');
        expect(listFilterInForce({ options, initial }, 'odd')).toBe('all');
        expect(listFiltersOf([odd], RULES)).toEqual({ options: [], initial: null });
    });

    it('a chosen filter not shown is never the default', () => {
        expect(listFiltersOf([TREE[4], TREE[1]], RULES, 'unread').initial).toBe('direct');
    });

    it('a filter node names a value; no other node is one', () => {
        expect(TREE.map(isListFilter)).toEqual([false, true, true, true, true]);
        expect(isListFilter(node('/x', { action: 'filter' }))).toBeFalse();
        expect(isListFilter(node('/x', { action: 'filter', value: '' }))).toBeFalse();
    });
});

describe('listFilterInForce', () => {
    it('is the chosen one while it is a choice, else the default', () => {
        const filters = listFiltersOf(TREE, RULES, 'unread');
        expect(listFilterInForce(filters, 'unread')).toBe('unread');
        expect(listFilterInForce(filters, 'gone')).toBe('all');
        expect(listFilterInForce(filters, null)).toBe('all');
    });

    it('without choices there is none, whatever value was kept', () => {
        expect(listFilterInForce(listFiltersOf([TREE[0]], RULES, 'unread'), 'unread')).toBeNull();
        expect(listFilterInForce(listFiltersOf([], RULES), null)).toBeNull();
    });

    it('with one choice there is none either: a list with no button is not filtered', () => {
        expect(listFilterInForce(listFiltersOf([TREE[1]], RULES), null)).toBeNull();
        expect(listFilterInForce(listFiltersOf([TREE[1]], RULES, 'direct'), 'direct')).toBeNull();
    });
});
