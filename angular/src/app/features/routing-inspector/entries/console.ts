import { consoleEntry } from '@coolms/core-angular';
import { RoutingInspectorFormComponent } from '../routing-inspector-form.component';
import { RoutingInspectorOutcomeComponent } from '../routing-inspector-outcome.component';
import { RoutingInspectorStateService } from '../routing-inspector-state.service';
import { RoutingInspectorStepsComponent } from '../routing-inspector-steps.component';

/**
 * Web's console entry: the Routing Inspector -- the generic inspector layout
 * over config/modules/web/layout/routing-inspector.yaml, its three slot
 * components, and the route-scoped state they share (console@1).
 */
export default consoleEntry({
    module:   'web',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:      'routing-inspector',
            component: () => import('@coolms/ui-angular').then(m => m.InspectorLayoutComponent),
            providers: [RoutingInspectorStateService],
            nav:       { activeNav: '/routing-inspector', layoutId: 'web:routing-inspector' },
        },
    ],
    bindings: [
        { name: 'RoutingInspectorForm',    component: RoutingInspectorFormComponent },
        { name: 'RoutingInspectorOutcome', component: RoutingInspectorOutcomeComponent },
        { name: 'RoutingInspectorSteps',   component: RoutingInspectorStepsComponent },
    ],
});
