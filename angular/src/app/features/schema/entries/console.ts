import { consoleEntry } from '@coolms/core-angular';
import { RUNTIME_TYPES_PORT } from '@coolms/ui-angular';
import { DynamicEntitiesPageComponent } from '../dynamic-entities-page.component';
import { SchemaService } from '../schema.service';

/**
 * DynamicEntity's console entry: the dynamic entities page, the dynamic
 * records list, and the runtime-types port the shared record list reads
 * (console@1).
 */
export default consoleEntry({
    module:   'dynamic_entity',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'dynamic-entities',
            component: () => import('../dynamic-entities-page.component').then(m => m.DynamicEntitiesPageComponent),
            nav:       { activeNav: '/dynamic-entities', breadcrumb: { label: 'Dynamic Entities', routerLink: '/dynamic-entities' } },
        },
        { path: 'dynamic-records', redirectTo: 'dynamic-entities' },
        {
            path:      'dynamic-records/:typeAlias',
            component: () => import('@coolms/ui-angular').then(m => m.DynamicRecordPageComponent),
            nav:       { activeNav: '/system/entities', breadcrumb: { label: 'Dynamic Records', routerLink: '/system/entities' } },
        },
    ],
    bindings: [{ name: 'DynamicEntitiesPage', component: DynamicEntitiesPageComponent }],
    providers: [{ port: RUNTIME_TYPES_PORT, useExisting: SchemaService }],
});
