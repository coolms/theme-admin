import { consoleEntry } from '@coolms/core-angular';
import { NotificationBellComponent } from '../notification-bell.component';

/**
 * Notification's console entry: the bell in the top bar -- unread count and
 * the notification drawer it opens (console@1).
 */
export default consoleEntry({
    module:   'notification',
    contract: 'console',
    range:    '^1.0',
    topbar: [{ id: 'notification.bell', order: 60, component: NotificationBellComponent }],
});
