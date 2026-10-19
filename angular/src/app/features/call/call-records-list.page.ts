import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { CallApiService } from './call-api.service';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    DeclaredRowsNoticeComponent,
    declaredRowsSource,
    PageTitleService,
    type DataGridLoadRequest,
} from '@coolms/ui-angular';

/**
 * Call history admin list page (/admin/call/records).
 *
 * Read-only, server-side paginated: the DataGrid emits `(loadMore)` on mount
 * + on every sort / filter change; this page calls
 * {@link ApiService.listCallRecordsPage} and feeds the result envelope back
 * via `[externalData]` (mirrors the Schedules list, minus create/edit/delete --
 * CallRecords are minted only by the AMI event stream, never the API).
 *
 * Drill-in: the `open` row action (context menu) or the toolbar
 * Open button (on a selected row) navigates to `/call/records/:id`.
 */
@Component({
    selector: 'coolms-admin-call-records-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent, DeclaredRowsNoticeComponent],
    template: `
        <cms-list-page
            title="Call history"
            icon="telephone"
            toolbarTreeSlug="navi.toolbar.call.records"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <cms-declared-rows-notice [source]="rows" />
            <coolms-datagrid
                gridId="call:records"
                [hidden]="!rows.showsRows()"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="rows.data()"
                (configLoaded)="rows.use($event)"
                (rowActionTriggered)="onRowAction($event)"
                (rowSelected)="onRowSelected($event)"
                (loadMore)="onLoadMore($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class CallRecordsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;
    private readonly callApi = inject(CallApiService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly titleSvc   = inject(PageTitleService);

    private readonly PAGE_SIZE = 50;

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * The rows, from where the grid's definition says they come from (`rows.operation`, `call.record.list`) and in
     * its query style -- this page names no list route.
     */
    readonly rows       = declaredRowsSource({ pageSize: this.PAGE_SIZE });
    /** Total rows matching the current filter set, server-reported. */
    readonly totalItems = computed(() => this.rows.data().totalItems);
    /** True after the first response (success OR error); the footer stays blank before it. */
    private readonly loaded = this.rows.loaded;

    /** Footer-bar label; blank until the first load resolves. */
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.totalItems()} call${this.totalItems() === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Toolbar `showWhen` context; `_selected` gates the row-level Open action. */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    ngOnInit(): void {
        this.titleSvc.set('Call history');
    }

    /** Fired on mount and on every sort / filter change and sentinel scroll; the rows source answers. */
    onLoadMore(event: DataGridLoadRequest): void {
        this.rows.load(event);
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    /** Row context-menu actions. `open` drills into the call detail. */
    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action === 'open') this.openDetail(event.row);
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.grid?.reload(); return; }
        if (id === 'open') { const row = this.selectedRow(); if (row) this.openDetail(row); }
    }

    /** Navigate to the read-only call detail. */
    private openDetail(row: Record<string, unknown>): void {
        const id = row['id'];
        if (typeof id === 'string' && id !== '') void this.router.navigate(['/call/records', id]);
    }

    /** Monotonically-increasing load counter; stale paged responses are discarded. */
}
