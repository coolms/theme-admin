import { consoleEntry } from '@coolms/core-angular';
import { MessagesQuickAccessComponent } from '../messages-quick-access.component';

/**
 * Chat's console entry: the internal chat -- user-to-user conversations over
 * the Chat engine, two panes, full height -- and its tile in the top bar
 * (console@1).
 *
 * The mount is `chat`; `messages`, what it was called until 2026-09-22,
 * redirects, so a bookmark, a link in a notification and the drawer's
 * "Open chat" all keep working.
 */
export default consoleEntry({
    module:   'chat',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'chat',
            children: () => import('../messages.routes').then(m => m.MESSAGES_ROUTES),
            nav:      { activeNav: '/chat', fullHeight: true },
        },
        { path: 'messages', redirectTo: 'chat' },
    ],
    topbar: [{ id: 'chat.quick-access', order: 30, component: MessagesQuickAccessComponent }],
});
