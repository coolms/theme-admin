import { consoleEntry } from '@coolms/core-angular';

/**
 * Section's console entry: the site sections admin (console@1). Its state is the host's; these are the module's own screens.
 */
export default consoleEntry({
    module:   'section',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'sections',
            children:  () => import('../sections.routes').then(m => m.SECTION_ROUTES),
        },
    ],
});
