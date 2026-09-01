import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import {
    ExplorerLayoutComponent,
    PageFooterService,
    PageToolbarComponent,
} from '@coolms/ui-angular';
import { DomainExplorerStateService } from './domain-explorer-state.service';

/**
 * Host shell for the Domain Explorer feature.
 *
 * Title and icon are declared in domain-explorer.yaml and rendered by
 * ExplorerLayoutComponent's YAML-driven header — no manual projection needed.
 *
 * The toolbar holds only action buttons; the FQCN + alias + type-badge
 * breadcrumb now lives as a sticky band at the top of the detail panel
 * (see DomainExplorerDetailComponent) — same pattern as VFS / Media /
 * Documents explorers.
 *
 * Context-menu overlays live HERE (page level) so they are rendered above
 * any overflow:hidden ancestor inside the explorer panel.
 */
@Component({
    selector: 'app-domain-explorer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DomainExplorerStateService, PageFooterService],
    imports: [ExplorerLayoutComponent, PageToolbarComponent],
    styles: [`
        :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    `],
    template: `
        <app-explorer-layout layoutId="dynamic_entity:domain-explorer">

            <!-- -- Toolbar ------------------------------------------------ -->
            <app-page-toolbar
                treeSlug="navi.toolbar.domain_explorer"
                [context]="state.context()"
                (actionClick)="onToolbarAction($event)">
            </app-page-toolbar>

        </app-explorer-layout>
    `,
})
export class DomainExplorerComponent implements OnInit {
    readonly state = inject(DomainExplorerStateService);

    ngOnInit(): void {
        this.state.loadAll();
    }

    onToolbarAction(id: string): void {
        this.state.handleToolbarAction(id);
    }
}
