import { consoleEntry } from '@coolms/core-angular';

/**
 * Scheduler's console entry: schedules list + detail with the cron/RRule editor, calendar attachment, payload editor, trigger-now (console@1).
 */
export default consoleEntry({
    module:   'scheduler',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'schedules',
            children:  () => import('../schedules.routes').then(m => m.SCHEDULE_ROUTES),
            nav:       { activeNav: '/schedules' },
        },
    ],
});
