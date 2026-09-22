import { consoleEntry } from '@coolms/core-angular';
import { MessagesQuickAccessComponent } from '../messages-quick-access.component';

/**
 * Chat's console entry: internal messages -- user-to-user conversations over
 * the Chat engine, two panes, full height -- and the messages tile in the top
 * bar (console@1).
 */
export default consoleEntry({
    module:   'chat',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'messages',
            children: () => import('../messages.routes').then(m => m.MESSAGES_ROUTES),
            nav:      { activeNav: '/messages', fullHeight: true },
        },
    ],
    topbar: [{ id: 'chat.quick-access', order: 30, component: MessagesQuickAccessComponent }],
});
