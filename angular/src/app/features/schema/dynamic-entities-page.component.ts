import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import {
    ExplorerLayoutComponent,
    PageActionsService,
    PageFooterService,
    PageToolbarComponent,
    ToolbarAction,
} from '@coolms/ui-angular';
import { DomainExplorerStateService } from './domain-explorer-state.service';

/**
 * Standalone page for browsing and managing Dynamic Types.
 *
 * Title and icon are declared in dynamic-entities.yaml and rendered by
 * ExplorerLayoutComponent's YAML-driven header.
 *
 * The toolbar holds only action buttons; the FQCN + type-badge breadcrumb
 * lives as a sticky band at the top of the detail panel — see
 * DomainExplorerDetailComponent (, mirroring /).
 */
@Component({
    selector: 'app-dynamic-entities-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DomainExplorerStateService, PageFooterService, PageActionsService],
    imports: [ExplorerLayoutComponent, PageToolbarComponent],
    styles: [`
        :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    `],
    template: `
        <app-explorer-layout
            layoutId="dynamic_entity:dynamic-entities"
            [headerActions]="headerActions()"
            (headerActionClick)="onHeaderAction($event)">

            <app-page-toolbar
                treeSlug="navi.toolbar.domain_explorer"
                [context]="state.context()"
                (actionClick)="onToolbarAction($event)">
            </app-page-toolbar>

        </app-explorer-layout>
    `,
})
export class DynamicEntitiesPageComponent implements OnInit {
    readonly state = inject(DomainExplorerStateService);

    readonly headerActions = computed((): ToolbarAction[] => {
        if (this.state.viewMode() === 'records') {
            return [
                { id: 'new-record', icon: 'plus-lg', label: 'New Record', primary: true },
            ];
        }
        return [
            { id: 'new-type', icon: 'plus-lg', label: 'New Type', primary: true },
        ];
    });

    ngOnInit(): void {
        this.state.showDynamicTypes.set(true);
        this.state.showEntities.set(false);
        this.state.loadRoot();
    }

    onHeaderAction(id: string): void {
        if (id === 'new-type')   this.state.openCreateType();
        if (id === 'new-record') this.state.openAddRecord();
    }

    onToolbarAction(id: string): void {
        this.state.handleToolbarAction(id);
    }
}
