import { consoleEntry } from '@coolms/core-angular';
import { DynamicChatQuickAccessComponent } from '../dynamic-chat-quick-access.component';

/**
 * DynamicChat's console entry: the agent inbox of open visitor conversations
 * (queue + thread + composer), full height, and the agent-queue tile in the
 * top bar (console@1).
 */
export default consoleEntry({
    module:   'dynamic-chat',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'dynamic-chat',
            children: () => import('../dynamic-chat.routes').then(m => m.DYNAMIC_CHAT_ROUTES),
            nav:      { activeNav: '/dynamic-chat', fullHeight: true },
        },
    ],
    topbar: [{ id: 'dynamic-chat.quick-access', order: 40, component: DynamicChatQuickAccessComponent }],
});
