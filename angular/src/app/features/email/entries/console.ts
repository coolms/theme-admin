import { consoleEntry } from '@coolms/core-angular';
import { EmailQuickAccessComponent } from '../email-quick-access.component';
import { ProfileMailTabComponent } from '../profile-mail-tab.component';

/**
 * Email's console entry: the three-pane mailbox client (mailbox rail /
 * message list / detail + composer), full height, the mailbox tile in the
 * top bar, and the Mail pane of My Profile (console@1).
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
    // Identity's profile.tab slot: the Mail pane for the `mail` settings section.
    bindings: [{ name: 'profile.tab:mail', component: ProfileMailTabComponent }],
});
