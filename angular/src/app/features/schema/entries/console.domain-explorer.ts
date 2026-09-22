import { consoleEntry } from '@coolms/core-angular';
import { DomainExplorerDetailComponent } from '../domain-explorer-detail.component';
import { DomainExplorerTreeComponent } from '../domain-explorer-tree.component';

/**
 * DomainExplorer's console entry: the entities explorer under /system and its
 * two slot components (console@1). It shares the schema feature directory
 * with DynamicEntity, hence the qualified file name.
 */
export default consoleEntry({
    module:   'domain_explorer',
    contract: 'console',
    range:    '^1.0',
    routes: [
        { path: 'system', redirectTo: 'system/entities' },
        {
            path:      'system/entities',
            component: () => import('../domain-explorer.component').then(m => m.DomainExplorerComponent),
        },
    ],
    bindings: [
        { name: 'DomainExplorerTree',   component: DomainExplorerTreeComponent },
        { name: 'DomainExplorerDetail', component: DomainExplorerDetailComponent },
    ],
});
