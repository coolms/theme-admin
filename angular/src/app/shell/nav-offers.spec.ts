import { signal } from '@angular/core';
import { type NaviGraphNode } from '@coolms/core-angular';
import { navOffers } from './nav-offers';

function node(path: string, resource: string | undefined, children: NaviGraphNode[] = []): NaviGraphNode {
    return {
        id: path, path, title: path, parentId: null, sortOrder: 0, isActive: true, isVisible: true,
        meta: undefined === resource ? {} : { resource }, children,
    };
}

describe('navOffers', () => {
    it('is false until the navigation has loaded, so a tile never flashes in and out', () => {
        expect(navOffers(signal<NaviGraphNode[]>([]), '/api/v1/calendar')()).toBeFalse();
    });

    it('finds the module\'s item at any depth of the navigation the server answered', () => {
        const nav = signal<NaviGraphNode[]>([node('/content', undefined, [node('/calendars', '/api/v1/calendar')])]);

        expect(navOffers(nav, '/api/v1/calendar')()).toBeTrue();
        expect(navOffers(nav, '/api/v1/chat/conversations')()).toBeFalse();
    });

    it('follows the navigation when it changes', () => {
        const nav = signal<NaviGraphNode[]>([node('/email', '/api/v1/email/mailboxes')]);
        const offered = navOffers(nav, '/api/v1/chat/conversations');
        expect(offered()).toBeFalse();

        nav.set([node('/messages', '/api/v1/chat/conversations')]);
        expect(offered()).toBeTrue();
    });
});
