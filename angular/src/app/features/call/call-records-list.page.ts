import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { ApiService, CallRecordDto } from '../../api/api.service';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';

/**
 * M9.f.1 — Call history admin list page (/admin/call/records).
 *
 * Read-only, server-side paginated: the DataGrid emits `(loadMore)` on mount
 * + on every sort / filter change; this page calls
 * {@link ApiService.listCallRecordsPage} and feeds the result envelope back
 * via `[externalData]` (mirrors the Schedules list, minus create/edit/delete —
 * CallRecords are minted only by the AMI event stream (M9.a.2), never the API).
 *
 * M9.f.2 — drill-in: the `open` row action (context menu) or the toolbar
 * Open button (on a selected row) navigates to `/call/records/:id`.
 */
@Component({
    selector: 'coolms-admin-call-records-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Call history"
            icon="telephone"
            toolbarTreeSlug="navi.toolbar.call.records"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="call:records"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
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

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly toast      = inject(ToastService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly PAGE_SIZE = 50;

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Current window of loaded call records. */
    readonly records    = signal<CallRecordDto[]>([]);
    /** Total rows matching the current filter set, server-reported. */
    readonly totalItems = signal(0);
    /**
     * Flips `true` after the first `loadMore` response (success OR error).
     * Before that, `hasMore` is forced `true` so the lazy sentinel fires the
     * initial fetch (empty rows + zero total would otherwise compute
     * `hasMore = false` and trap the page in "No data found").
     */
    private readonly loaded = signal(false);

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

    /** Grid payload; `hasMore` drives the sentinel-based lazy fetch loop. */
    readonly gridData = computed((): DataGridData => {
        const rows = this.records();
        return {
            items:      rows.map(r => ({ ...r })),
            totalItems: this.totalItems(),
            page:       1,
            limit:      this.PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / this.PAGE_SIZE)),
            hasMore:    !this.loaded() || rows.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Call history');
    }

    /**
     * Single entry point for the grid's lazy-mode fetch loop. Fired on mount
     * (offset=0, reset=true) and on every sort / filter change. Pages from the
     * offset; non-reset events append to the current window.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page = Math.floor(event.offset / this.PAGE_SIZE) + 1;
        const epoch = ++this._loadEpoch;

        this.api.listCallRecordsPage({
            page,
            pageSize: this.PAGE_SIZE,
            sort:     event.sort,
            filters:  event.columnFilters,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                if (epoch !== this._loadEpoch) return; // stale
                const merged = event.reset
                    ? result.items
                    : [...this.records(), ...result.items];
                this.records.set(merged);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
            },
            error: () => {
                this.loaded.set(true); // flip even on error so the sentinel doesn't retry-loop
                this.toast.error('Failed to load call history');
            },
        });
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

    /** Navigate to the read-only call detail (M9.f.2). */
    private openDetail(row: Record<string, unknown>): void {
        const id = row['id'];
        if (typeof id === 'string' && id !== '') void this.router.navigate(['/call/records', id]);
    }

    /** Monotonically-increasing load counter; stale paged responses are discarded. */
    private _loadEpoch = 0;
}
