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
import { ApiService, CalendarDto } from '../../api/api.service';
import { AppConfigState, ErrorHandlerService } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    DataGridData,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { CalendarFormDialogComponent } from './calendar-form-dialog.component';

/**
 * #472 — Calendars admin list page (/admin/calendars).
 *
 * Server-side paginated. The DataGrid emits `(loadMore)` on its mount
 * + on every sort / filter change with `{offset, sort, columnFilters}`;
 * this page calls into {@link ApiService.listCalendarsPage} with the
 * mapped paging params and feeds the result envelope back via
 * `[externalData]`. No client-side filtering — the `currentUserAccess`
 * "Show owned/shared/admin" picker is now a regular column filter in
 * the grid's filter row (driven by the YAML's `enumOptions`).
 *
 * Per-row `ownerLabel`, `currentUserAccess`, and `isDefaultPersonal`
 * are already projected by `ListCalendarsProvider` (batches the User
 * lookup once per request). `parentSlug` is still derived in-process
 * from the loaded page.
 */
@Component({
    selector: 'coolms-admin-calendars-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, CmsListPageComponent],
    template: `
        <cms-list-page
            title="Calendars"
            icon="calendar3"
            toolbarTreeSlug="navi.toolbar.calendar.calendars"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="calendar:calendars"
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
export class CalendarsListComponent implements OnInit {
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

    private readonly PAGE_SIZE = 50;

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /** Current page's calendars (used for row-action lookups by id). */
    readonly calendars = signal<CalendarDto[]>([]);
    /** Total rows that match the current filter set, server-reported. */
    readonly totalItems = signal(0);
    /**
     * Flips to `true` after the first `loadMore` response (success OR
     * error). Before that, `hasMore` is forced `true` so the grid's
     * lazy-mode sentinel kickoff fires the initial fetch — without
     * this, an empty calendars signal + totalItems=0 would compute
     * `hasMore=false` from the very first render and the sentinel
     * would never trigger `onLoadMore`. Same effect as the original
     * `hasMore = signal(true)` seed, but the semantic is honest.
     */
    private readonly loaded = signal(false);

    /** Footer-bar label; blank until the first load resolves. */
    readonly footerLabel = computed(() =>
        this.loaded() ? `${this.totalItems()} calendar${this.totalItems() === 1 ? '' : 's'}` : '',
    );

    /** Currently selected datagrid row (null when nothing is selected). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * Context passed to the toolbar for showWhen evaluation. `_selected`
     * gates the row-level actions; `_isDefaultPersonalRow` lets the YAML
     * hide the Delete action on the user's own personal calendar.
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected:             row !== null,
            _isDefaultPersonalRow: row !== null && row['isDefaultPersonal'] === true,
        };
    });

    /**
     * Grid payload. We project parentSlug in-process (small linear
     * scan on the current page; no extra API call). hasMore drives the
     * sentinel-based lazy-mode fetch loop.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.calendars();
        const byId = new Map(rows.map(c => [c.id, c] as const));
        return {
            items: rows.map(c => ({
                ...c,
                slug:       c.slug ?? '',
                ownerLabel: c.ownerLabel ?? '',
                parentSlug: c.parentId
                    ? byId.get(c.parentId)?.slug ?? c.parentId.slice(0, 8) + '…'
                    : '',
            })),
            totalItems: this.totalItems(),
            page:       1,
            limit:      this.PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / this.PAGE_SIZE)),
            hasMore:    !this.loaded() || rows.length < this.totalItems(),
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Calendars');
    }

    /**
     * Single entry point for the grid's lazy-mode fetch loop. Fired on
     * mount (offset=0, reset=true) and on every sort / filter change.
     * When the user scrolls the sentinel into view, `loadMore` fires
     * with `offset = current items.length` and we fetch the next page.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page = Math.floor(event.offset / this.PAGE_SIZE) + 1;
        const epoch = ++this._loadEpoch;

        this.api.listCalendarsPage({
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
                    : [...this.calendars(), ...result.items];
                this.calendars.set(merged);
                this.totalItems.set(result.totalItems);
                this.loaded.set(true);
            },
            error: () => {
                this.loaded.set(true); // flip even on error so sentinel doesn't retry-loop
                this.toast.error('Failed to load calendars');
            },
        });
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const cal = this.calendars().find(c => c.id === (event.row['id'] as string));
        if (!cal) return;
        // `edit` was previously routed here too but the YAML now exposes
        // only `open` — the detail page handles every edit inline.
        if (event.action === 'open')   this.openDetail(cal);
        if (event.action === 'delete') this.confirmDelete(cal);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreate(); return; }
        if (id === 'reload') { this.grid?.reload(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const cal = this.calendars().find(c => c.id === (row['id'] as string));
        if (!cal) return;
        if (id === 'open')   this.openDetail(cal);
        if (id === 'delete') this.confirmDelete(cal);
    }

    private openCreate(): void {
        this.dialog.open<CalendarDto | null>(CalendarFormDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed.pipe(
            filter((cal): cal is CalendarDto => cal !== null && cal !== undefined),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(cal => {
            this.toast.success(`Calendar "${cal.label}" created`);
            if (cal.slug) {
                void this.router.navigate(['/calendars', cal.slug]);
            } else {
                this.grid?.reload();
            }
        });
    }

    private openDetail(cal: CalendarDto): void {
        if (!cal.slug) return;
        void this.router.navigate(['/calendars', cal.slug]);
    }

    private confirmDelete(cal: CalendarDto): void {
        if (!cal.slug) return;
        if (cal.isDefaultPersonal === true) {
            this.toast.error('Your default personal calendar cannot be deleted.');
            return;
        }
        this.confirmSvc.confirmDelete(cal.label ?? cal.slug).pipe(
            filter(Boolean),
            switchMap(() => this.api.deleteCalendar(cal.slug!)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => { this.toast.success('Calendar deleted'); this.grid.reload(); },
            error: (e: unknown) => this.toast.error(this.errors.humanize(e)),
        });
    }

    /** Monotonically-increasing load counter; stale paged responses are discarded. */
    private _loadEpoch = 0;
}
