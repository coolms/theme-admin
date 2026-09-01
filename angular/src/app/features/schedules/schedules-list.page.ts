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
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { ScheduleFormDialogComponent } from './schedule-form-dialog.component';
import { ApiService, ScheduleDto } from '../../api/api.service';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    DateTimeFormatService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';

/**
 * Sibling — Schedules admin list page (/admin/schedules).
 *
 * Server-side paginated. The DataGrid emits `(loadMore)` on its mount
 * + on every sort / filter change; this page calls
 * {@link ApiService.listSchedulesPage} with the mapped paging params
 * and feeds the result envelope back via `[externalData]`. No
 * client-side filtering, no second round-trip to resolve calendar
 * slugs — `calendarSlug` + `ownerLabel` now come back as projection
 * slots from {@link ListSchedulesProvider}.
 */
@Component({
    selector: 'coolms-admin-schedules-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Schedules"
            icon="alarm"
            toolbarTreeSlug="navi.toolbar.scheduler.schedules"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="scheduler:schedules"
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
export class SchedulesListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid!: DataGridComponent;

    private readonly api         = inject(ApiService);
    private readonly store       = inject(Store);
    private readonly router      = inject(Router);
    private readonly dialog      = inject(Dialog);
    private readonly confirmSvc  = inject(ConfirmDialogService);
    private readonly toast       = inject(ToastService);
    private readonly errors      = inject(ErrorHandlerService);
    private readonly titleSvc    = inject(PageTitleService);
    private readonly destroyRef  = inject(DestroyRef);
    private readonly dtf         = inject(DateTimeFormatService);

    private readonly PAGE_SIZE = 50;

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Current page's schedules (used for row-action lookups by id). */
    readonly schedules   = signal<ScheduleDto[]>([]);
    /** Total rows that match the current filter set, server-reported. */
    readonly totalItems  = signal(0);
    /**
     * Flips `true` after the first `loadMore` response (success OR
     * error). Before that, `hasMore` is forced `true` so the lazy
     * sentinel fires the initial fetch — empty schedules + zero total
     * would otherwise compute `hasMore = false` and trap the page in
     * "No data found" forever.
     */
    private readonly loaded = signal(false);

    /** Footer-bar label; blank until the first load resolves. */
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.totalItems()} schedule${this.totalItems() === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * Context passed to the toolbar for showWhen evaluation. `_selected`
     * gates row-level actions; `enabled` lets the toolbar YAML hide
     * the Trigger-now action on disabled schedules.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected: row !== null,
            enabled:   row !== null && row['enabled'] === true,
        };
    });

    /**
     * Grid payload. `calendarSlug` arrives pre-resolved from the
     * backend — no FE-side calendar UUID-to-slug map needed. hasMore
     * drives the sentinel-based lazy fetch loop.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.schedules();
        return {
            items: rows.map(s => ({
                ...s,
                slug:         s.slug ?? '',
                calendarSlug: s.calendarSlug ?? '',
                ownerLabel:   s.ownerLabel ?? '',
            })),
            totalItems: this.totalItems(),
            page:       1,
            limit:      this.PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / this.PAGE_SIZE)),
            hasMore:    !this.loaded() || rows.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Schedules');
    }

    /**
     * Single entry point for the grid's lazy-mode fetch loop. Fired on
     * mount (offset=0, reset=true) and on every sort / filter change.
     * Pages from the offset; non-reset events append to the current page.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page = Math.floor(event.offset / this.PAGE_SIZE) + 1;
        const epoch = ++this._loadEpoch;

        this.api.listSchedulesPage({
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
                    : [...this.schedules(), ...result.items];
                this.schedules.set(merged);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
            },
            error: () => {
                this.loaded.set(true); // flip even on error so sentinel doesn't retry-loop
                this.toast.error('Failed to load schedules');
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const s = this.schedules().find(x => x.id === (event.row['id'] as string));
        if (!s) return;
        if (event.action === 'open')    this.openDetail(s);
        if (event.action === 'edit')    this.openDetail(s);
        if (event.action === 'trigger') this.confirmTrigger(s);
        if (event.action === 'delete')  this.confirmDelete(s);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const s = this.schedules().find(x => x.id === (row['id'] as string));
        if (!s) return;
        if (id === 'open')    this.openDetail(s);
        if (id === 'edit')    this.openDetail(s);
        if (id === 'trigger') this.confirmTrigger(s);
        if (id === 'delete')  this.confirmDelete(s);
    }

    private openCreate(): void {
        this.dialog.open<ScheduleDto | null>(ScheduleFormDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((s): s is ScheduleDto => s !== null && s !== undefined),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(s => {
            this.toast.success(`Schedule "${s.name}" created`);
            if (s.slug) {
                void this.router.navigate(['/schedules', s.slug]);
            } else {
                this.grid?.reload();
            }
        });
    }

    private openDetail(s: ScheduleDto): void {
        if (!s.slug) return;
        void this.router.navigate(['/schedules', s.slug]);
    }

    private confirmTrigger(s: ScheduleDto): void {
        if (!s.slug) return;
        this.confirmSvc.open({
            title:        'Trigger schedule',
            message:      `Trigger "${s.name ?? s.slug}" now? This dispatches an out-of-band run that bypasses the schedule's normal fire window.`,
            confirmLabel: 'Trigger now',
        }).pipe(
            filter(Boolean),
            switchMap(() => this.api.triggerScheduleNow(s.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  res => {
                const when = res.firedAt
                    ? this.dtf.dateTime(res.firedAt)
                    : 'now';
                this.toast.success(`Schedule "${s.name ?? s.slug}" dispatched at ${when}`);
                this.grid?.reload();
            },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    private confirmDelete(s: ScheduleDto): void {
        if (!s.slug) return;
        this.confirmSvc.confirmDelete(s.name ?? s.slug).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteSchedule(s.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Schedule deleted'); this.grid.reload(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** Monotonically-increasing load counter; stale paged responses are discarded. */
    private _loadEpoch = 0;
}
