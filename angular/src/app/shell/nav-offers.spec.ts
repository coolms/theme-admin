import { signal } from '@angular/core';
import { type NaviGraphNode } from '@coolms/core-angular';
import { navLocked, navOffers } from './nav-offers';

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

    it('reads the normalised resource the server adds too', () => {
        const item = { ...node('/calendars', undefined), resource: 'GET /api/v1/calendar' } as unknown as NaviGraphNode;

        expect(navOffers(signal<NaviGraphNode[]>([item]), '/api/v1/calendar')()).toBeTrue();
    });

    it('follows the navigation when it changes', () => {
        const nav = signal<NaviGraphNode[]>([node('/email', '/api/v1/email/mailboxes')]);
        const offered = navOffers(nav, '/api/v1/chat/conversations');
        expect(offered()).toBeFalse();

        nav.set([node('/messages', '/api/v1/chat/conversations')]);
        expect(offered()).toBeTrue();
    });

    it('does not offer an item the server answered "elevate": nothing may start on it before the grant', () => {
        const locked = { ...node('/call', '/api/v1/call/records'), access: 'elevate' } as NaviGraphNode;
        const nav = signal<NaviGraphNode[]>([locked]);

        expect(navOffers(nav, '/api/v1/call/records')()).toBeFalse();
        expect(navLocked(nav, '/api/v1/call/records')()).toBeTrue();
    });

    it('reads an item with no access (an older server) or "allowed" as offered, and never as locked', () => {
        const older = node('/email', '/api/v1/email/mailboxes');
        const allowed = { ...node('/messages', '/api/v1/chat/conversations'), access: 'allowed' } as NaviGraphNode;
        const nav = signal<NaviGraphNode[]>([older, allowed]);

        expect(navOffers(nav, '/api/v1/email/mailboxes')()).toBeTrue();
        expect(navLocked(nav, '/api/v1/email/mailboxes')()).toBeFalse();
        expect(navOffers(nav, '/api/v1/chat/conversations')()).toBeTrue();
        expect(navLocked(nav, '/api/v1/chat/conversations')()).toBeFalse();
    });

    it('turns a locked item into an offered one when the navigation is answered again after the grant', () => {
        const nav = signal<NaviGraphNode[]>([{ ...node('/call', '/api/v1/call/records'), access: 'elevate' } as NaviGraphNode]);
        const offered = navOffers(nav, '/api/v1/call/records');
        const locked = navLocked(nav, '/api/v1/call/records');
        expect([offered(), locked()]).toEqual([false, true]);

        nav.set([{ ...node('/call', '/api/v1/call/records'), access: 'allowed' } as NaviGraphNode]);
        expect([offered(), locked()]).toEqual([true, false]);
    });
});
