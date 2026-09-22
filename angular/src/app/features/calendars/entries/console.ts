import { consoleEntry } from '@coolms/core-angular';
import { CalendarQuickAccessComponent } from '../calendar-quick-access.component';

/**
 * Calendar's console entry: the calendars admin (list + detail with working
 * hours, holiday rules, year preview) and the personal-calendar tile in the
 * top bar (console@1).
 */
export default consoleEntry({
    module:   'calendar',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'calendars',
            children: () => import('../calendars.routes').then(m => m.CALENDAR_ROUTES),
            nav:      { activeNav: '/calendars' },
        },
    ],
    topbar: [{ id: 'calendar.quick-access', order: 10, component: CalendarQuickAccessComponent }],
});
