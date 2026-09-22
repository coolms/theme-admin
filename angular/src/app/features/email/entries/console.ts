import { consoleEntry } from '@coolms/core-angular';
import { EmailQuickAccessComponent } from '../email-quick-access.component';

/**
 * Email's console entry: the three-pane mailbox client (mailbox rail /
 * message list / detail + composer), full height, and the mailbox tile in the
 * top bar (console@1).
 */
export default consoleEntry({
    module:   'email',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'email',
            children: () => import('../email.routes').then(m => m.EMAIL_ROUTES),
            nav:      { activeNav: '/email', fullHeight: true },
        },
    ],
    topbar: [{ id: 'email.quick-access', order: 20, component: EmailQuickAccessComponent }],
});
