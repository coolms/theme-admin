import { signal, type WritableSignal } from '@angular/core';
import { type NaviAccess, type NaviGraphMeta, type NaviGraphNode } from '@coolms/core-angular';
import { lockOfPage, navItemOfPage, PageLock, pageAccess, routeOfNavItem } from './locked-page';

function item(route: string, access: NaviAccess = 'allowed', children: NaviGraphNode[] = [], meta: NaviGraphMeta = {}):
    NaviGraphNode {
    return {
        id: route, path: '/admin' + route, title: 'Item ' + route, parentId: null, sortOrder: 0, isActive: true,
        isVisible: true, meta: { route, ...meta }, access, children,
    };
}

/**
 * A page belongs to the menu item whose route it lies under, the longest one; a locked item locks it. The main area
 * shows the Elevate state in place of a page entered locked, and a notice above one whose elevation ended while it
 * was open.
 */
describe('locked page', () => {
    const menu = [
        item('/system', 'allowed', [
            item('/system/users', 'elevate'),
            item('/system/users/deletions', 'allowed'),
        ]),
        item('/content', 'allowed'),
    ];

    it('takes the longest route the page lies under', () => {
        expect(navItemOfPage(menu, '/system/users/7f3a', null)?.id).toBe('/system/users');
        expect(navItemOfPage(menu, '/system/users/deletions', null)?.id).toBe('/system/users/deletions');
        expect(navItemOfPage(menu, '/system/settings', null)?.id).toBe('/system');
    });

    it('does not take a route that only shares a prefix', () => {
        expect(navItemOfPage(menu, '/system/usersx', null)?.id).toBe('/system');
        expect(navItemOfPage(menu, '/contents', null)).toBeNull();
    });

    it('takes the item a child route nominates', () => {
        expect(navItemOfPage(menu, '/records/abc', '/system/users')?.id).toBe('/system/users');
        expect(navItemOfPage(menu, '/records/abc', 'system/users')?.id).toBe('/system/users');
    });

    it('locks a page under a locked item, and nothing else', () => {
        expect(lockOfPage(menu, '/system/users', null)?.id).toBe('/system/users');
        expect(lockOfPage(menu, '/system/users/7f3a', null)?.id).toBe('/system/users');
        expect(lockOfPage(menu, '/system/users/deletions', null)).toBeNull();
        expect(lockOfPage(menu, '/content/pages', null)).toBeNull();
        expect(lockOfPage(menu, '/nowhere', null)).toBeNull();
        expect(lockOfPage([], '/system/users', null)).toBeNull();
    });

    it('takes no heading or action for a page', () => {
        const actions = [
            item('/system', 'elevate', [], { type: 'separator' }),
            item('/terminal', 'elevate', [], { target: 'action.terminal' }),
            item('/calls', 'elevate', [], { target: 'action.panel:calls' }),
        ];

        expect(lockOfPage(actions, '/system/users', null)).toBeNull();
        expect(lockOfPage(actions, '/terminal', null)).toBeNull();
        expect(lockOfPage(actions, '/calls', null)).toBeNull();
    });

    it('reads the route as the sidebar links it', () => {
        expect(routeOfNavItem(item('/system/users'))).toBe('/system/users');
        const byPath = { ...item('/x'), meta: {}, path: '/admin/media' } as NaviGraphNode;
        expect(routeOfNavItem(byPath)).toBe('/media');
        const relative = { ...item('/x'), meta: { routerLink: 'navi' } } as NaviGraphNode;
        expect(routeOfNavItem(relative)).toBe('/navi');
    });

    describe('as the page and the menu change', () => {
        const locked = [item('/system/users', 'elevate'), item('/system/groups', 'elevate'), item('/content')];
        const open = [item('/system/users'), item('/system/groups'), item('/content')];
        // The menu is a signal, as the navigation service's is; the class is told when it answered.
        let nav: WritableSignal<NaviGraphNode[]>;
        let state: PageLock;
        beforeEach(() => {
            nav = signal(locked);
            state = new PageLock(nav, () => null);
        });
        const answer = (to: NaviGraphNode[]) => { nav.set(to); state.menuAnswered(); };

        it('shows the page until the menu has answered, then the Elevate state in place of one entered locked', () => {
            state.pageEntered('/system/users');
            expect(state.access()).toBe('page');

            answer(locked);
            expect(state.access()).toBe('gate');
            expect(state.lock()?.title).toBe('Item /system/users');
        });

        it('opens the page once the menu answers open after the grant', () => {
            state.pageEntered('/system/users');
            answer(locked);
            answer(open);

            expect(state.access()).toBe('page');
        });

        it('keeps the page under a notice when its elevation ends while it is open', () => {
            state.pageEntered('/system/users');
            answer(open);
            answer(locked);

            expect(state.access()).toBe('banner');
        });

        it('keeps the notice when only the query or fragment changes', () => {
            state.pageEntered('/system/users');
            answer(open);
            answer(locked);
            state.pageEntered('/system/users');

            expect(state.access()).toBe('banner');
        });

        it('takes a page entered again, after another, for entered locked', () => {
            state.pageEntered('/system/users');
            answer(open);
            answer(locked);
            state.pageEntered('/content');
            state.pageEntered('/system/users');

            expect(state.access()).toBe('gate');
        });

        it('takes a page entered again for entered locked when the page between was locked too', () => {
            state.pageEntered('/system/users');
            answer(open);
            answer(locked);
            state.pageEntered('/system/groups');
            expect(state.access()).toBe('gate');

            state.pageEntered('/system/users');
            expect(state.access()).toBe('gate');
        });

        it('takes a locked page for entered locked even when the page before it was open', () => {
            state.pageEntered('/content');
            answer(locked);
            expect(state.access()).toBe('page');

            state.pageEntered('/system/users');
            expect(state.access()).toBe('gate');
        });
    });

    it('shows the Elevate state in place of a page entered locked, a notice over one shown open before', () => {
        const lock = item('/system/users', 'elevate');

        expect(pageAccess(null, false)).toBe('page');
        expect(pageAccess(null, true)).toBe('page');
        expect(pageAccess(lock, false)).toBe('gate');
        expect(pageAccess(lock, true)).toBe('banner');
    });
});
