import { consoleChildren } from '@coolms/core-angular';
import chatEntry from './console';

/**
 * The rename, as routes.
 *
 * `messages` was this module's mount until 2026-09-22 and is in bookmarks, in
 * the drawer's jump and in whatever a notification links to; a rename that
 * drops it is a rename that breaks them. The redirect is `pathMatch: 'full'`,
 * which is right here because the mount has exactly one child (the page), and
 * a query string does not affect matching -- so `/admin/messages?c=<id>`
 * reaches the thread it names.
 */
describe('the Chat console entry', () => {
    it('mounts at chat and keeps messages as a redirect', () => {
        const routes = consoleChildren([chatEntry]);
        expect(routes.map(r => r.path)).toEqual(['chat', 'messages']);
        expect(routes[0].loadChildren).toBeDefined();
        expect(routes[0].data).toEqual({ activeNav: '/chat', fullHeight: true });
        expect(routes[1].redirectTo).toBe('chat');
        expect(routes[1].pathMatch).toBe('full');
    });

    it('is the chat module, so the manifest gates both paths together', () => {
        expect(chatEntry.module).toBe('chat');
        const routes = consoleChildren([chatEntry]);
        expect(routes[0].canMatch?.length).toBe(1);
    });
});
