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

import { ApiService, type DocumentGenerationDto } from '../../../api/api.service';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';

/**
 * Document Generations admin list page (/admin/documents/generations).
 *
 * Server-side paginated, read-only. The DataGrid emits `(loadMore)` on its
 * mount + on every sort change; this page calls
 * {@link ApiService.listDocumentGenerations} with the mapped paging params and
 * feeds the result envelope back via `[externalData]`. Columns, the coloured
 * status badge, and the lazy infinite-scroll are all driven by the backend
 * datagrid config `document:generations`
 * (config/modules/document/datagrids/document_generations.yaml) — mirrors
 * {@link SchedulesListComponent}. Row-click / the `open` action drill into the
 * detail page. No filters yet (the endpoint is a simple paged list); `createdAt`
 * is the one sortable column (the backend's natural order).
 */
@Component({
    selector: 'app-document-generation-list-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Document generations"
            icon="file-earmark-bar-graph"
            toolbarTreeSlug="navi.toolbar.document.generations"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="document:generations"
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
export class DocumentGenerationListPageComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api        = inject(ApiService);
    private readonly store      = inject(Store);
    private readonly router     = inject(Router);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly PAGE_SIZE = 50;

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Current page's generations (used for row-action lookups by id). */
    readonly generations = signal<DocumentGenerationDto[]>([]);
    /** Total rows, server-reported. */
    readonly totalItems  = signal(0);
    /**
     * Flips `true` after the first `loadMore` response (success OR error).
     * Before that, `hasMore` is forced `true` so the lazy sentinel fires the
     * initial fetch — empty rows + zero total would otherwise compute
     * `hasMore = false` and trap the page in "No data found" forever.
     */
    private readonly loaded = signal(false);

    /** Footer-bar label; blank until the first load resolves. */
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.totalItems()} generation${this.totalItems() === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /** Context passed to the toolbar for showWhen evaluation (`_selected`). */
    readonly toolbarContext = computed((): Record<string, unknown> => ({
        _selected: this.selectedRow() !== null,
    }));

    /** Grid payload; hasMore drives the sentinel-based lazy fetch loop. */
    readonly gridData = computed((): DataGridData => {
        const rows = this.generations();
        return {
            items:      rows.map(g => ({ ...g })),
            totalItems: this.totalItems(),
            page:       1,
            limit:      this.PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / this.PAGE_SIZE)),
            hasMore:    !this.loaded() || rows.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Document generations');
    }

    /**
     * Single entry point for the grid's lazy-mode fetch loop. Fired on mount
     * (offset=0, reset=true) and on every sort change. Pages from the offset;
     * non-reset events append to the current page.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page = Math.floor(event.offset / this.PAGE_SIZE) + 1;
        const epoch = ++this._loadEpoch;

        this.api.listDocumentGenerations({
            page,
            limit: this.PAGE_SIZE,
            sort:  event.sort ?? '-createdAt',
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                if (epoch !== this._loadEpoch) return; // stale
                const merged = event.reset
                    ? result.items
                    : [...this.generations(), ...result.items];
                this.generations.set(merged);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
            },
            error: () => {
                this.loaded.set(true); // flip even on error so sentinel doesn't retry-loop
                this.toast.error('Failed to load generations');
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        if (event.action === 'open') this.openDetail(event.row['id'] as string);
    }

    onToolbarAction(id: string): void {
        if (id === 'reload') { this.grid?.reload(); return; }
        if (id === 'open') {
            const row = this.selectedRow();
            if (row) this.openDetail(row['id'] as string);
        }
    }

    private openDetail(id: string): void {
        if (!id) return;
        void this.router.navigate(['/documents/generations', id]);
    }

    /** Monotonically-increasing load counter; stale paged responses are discarded. */
    private _loadEpoch = 0;
}
