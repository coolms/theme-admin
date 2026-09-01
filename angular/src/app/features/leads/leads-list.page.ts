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
import { filter } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    TabStripComponent,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { LeadDto, LeadStatus, LeadsService } from './leads.service';

interface StatusTab {
    readonly id:    LeadStatus;
    readonly label: string;
    readonly icon:  string;
}

/** Rows per lazy page — matches the grid YAML's `dataSource.pageSize`. */
const PAGE_SIZE = 50;

/**
 * W8.c — Lead inbox admin page (/admin/leads).
 *
 * The visitor-facing W8.b contact form POSTs to the W8.a backend; this is
 * where an admin triages what comes in. Three buckets (New / Handled / Spam)
 * via {@link LeadsService}, each server-filtered, sorted and paged.
 *
 * Rendered as a `<coolms-datagrid>` (config from `lead:list` YAML, data fed as
 * `externalData`) for visual consistency with Forms / Calendars / Definitions /
 * Cockpit. The grid's rich cells surface the submitter (avatar + email), the
 * originating form + page (badge + link), the message (clamped snippet) and the
 * status (coloured badge); per-row triage actions (Handle / Spam / Reopen) live
 * in the right-click context menu, gated by each row's `status` (house style —
 * `showActionColumn: false`). Plain-text fields are auto-escaped by Angular
 * interpolation — no XSS sink.
 *
 * **`loadingMode: lazy`.** It used to be `client` — one request per
 * tab, whole bucket, filtered in the browser. But the endpoint capped that at
 * 200 rows, so the queue silently omitted leads past the cap AND every filter
 * searched a truncated window while presenting itself as the complete answer.
 * Rows now arrive a page at a time through `(loadMore)`, which is also the ONE
 * entry point for a filter change, a sort change and a tab switch.
 */
@Component({
    selector: 'coolms-admin-leads-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent, TabStripComponent],
    template: `
        <cms-list-page
            title="Leads"
            icon="inbox"
            subtitle="Triage incoming contact-form submissions"
            toolbarTreeSlug="navi.toolbar.lead.list"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <app-tab-strip
                [tabs]="tabs"
                [activeId]="status()"
                (selected)="selectTab($any($event))" />

            <coolms-datagrid
                gridId="lead:list"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (loadMore)="onLoadMore($event)"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    `],
})
export class LeadsListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    private readonly api        = inject(LeadsService);
    private readonly router     = inject(Router);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly tabs: StatusTab[] = [
        { id: 'new',     label: 'New',     icon: 'inbox' },
        { id: 'handled', label: 'Handled', icon: 'check2-circle' },
        { id: 'spam',    label: 'Spam',    icon: 'shield-x' },
    ];

    readonly status  = signal<LeadStatus>('new');
    readonly leads   = signal<LeadDto[]>([]);
    readonly loading = signal(true);
    /** Server's count for the CURRENT bucket + filter — drives the footer and `hasMore`. */
    readonly totalItems = signal(0);
    /** Flips true after the first response (success OR error) so the footer stops hiding. */
    readonly loaded = signal(false);

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;
    /** Ids with an in-flight transition — blocks double-submit. */
    private readonly busyIds = signal<ReadonlySet<string>>(new Set());

    /** Selected grid row — drives the toolbar's selection-gated triage actions (navi showWhen). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * showWhen context for the `navi.toolbar.lead.list` tree: `_selected` gates
     * the triage actions; `_status` mirrors the grid rowActions (Handle / Spam
     * on a New lead, Reopen on a Handled / Spam lead).
     */
    readonly toolbarContext = computed((): Record<string, unknown> => {
        const row = this.selectedRow();
        return {
            _selected: row !== null,
            _status:   row?.['status'] ?? '',
        };
    });

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * Lazy payload. `hasMore` drives the sentinel fetch loop: true until the
     * loaded window covers the server's total, and true before the first load
     * resolves so the grid emits its initial `(loadMore)`.
     */
    readonly gridData = computed((): DataGridData => {
        const rows = this.leads();
        return {
            items:      rows as unknown as Array<Record<string, unknown>>,
            totalItems: this.totalItems(),
            page:       1,
            limit:      PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(this.totalItems() / PAGE_SIZE)),
            hasMore:    this.loading() || rows.length < this.totalItems(),
        };
    });

    /**
     * Footer row-count strip (bottom-left) — the count lives here, not the
     * header. It is the SERVER's count for the bucket + active filter, so it no
     * longer silently means "rows I happened to load".
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        const bucket = this.status();
        // Say nothing at zero: the grid's own empty state distinguishes "nothing
        // in this queue" from "no matches", and the footer cannot tell the two
        // apart — a fixed message here would contradict the body the moment a
        // filter is what emptied the list.
        if (n === 0) return '';

        return `${n} ${bucket} lead${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Leads');
        // No fetch here — the grid emits `(loadMore)` on mount, which is the
        // single entry point. Fetching here too would race and double-load.
    }

    /**
     * The one place leads are fetched. Fired on mount, on every filter/sort
     * change (`reset`, offset 0), when the lazy sentinel scrolls in, and — via
     * `grid.reload()` — on a tab switch or a manual refresh.
     *
     * `columnFilters` is passed VERBATIM: the endpoint is RQL-native and its
     * allowlist is derived from the same `lead:list` YAML that renders the
     * filter row.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const page  = Math.floor(event.offset / PAGE_SIZE) + 1;
        const epoch = ++this.loadEpoch;

        this.api.listPage({
            status:   this.status(),
            page,
            pageSize: PAGE_SIZE,
            sort:     event.sort,
            filters:  event.columnFilters,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                // Filter and tab changes fire in quick succession and can land
                // out of order; a stale response would show the bucket the user
                // has already moved off.
                if (epoch !== this.loadEpoch) return;

                this.leads.set(event.reset ? result.items : [...this.leads(), ...result.items]);
                this.totalItems.set(result.totalItems);
                this.loading.set(false);
                this.loaded.set(true);
                if (event.reset) this.selectedRow.set(null);
            },
            error: () => {
                if (epoch !== this.loadEpoch) return;
                // Settle `hasMore` on failure too, or the sentinel retries the
                // failed page forever.
                this.loading.set(false);
                this.loaded.set(true);
                this.toast.error('Failed to load leads');
            },
        });
    }

    /** Toolbar actions: Refresh + Open + the selection-gated Handle / Spam / Reopen mirrors. */
    onToolbarAction(id: string): void {
        if (id === 'refresh') { this.load(); return; }
        const lead = this.selectedRow() as unknown as LeadDto | null;
        if (!lead?.id) return;
        if (id === 'open')   this.openDetail(lead);
        if (id === 'handle') this.act(lead, 'handle');
        if (id === 'reopen') this.act(lead, 'reopen');
        if (id === 'spam')   this.markSpam(lead);
    }

    selectTab(status: LeadStatus): void {
        if (this.status() === status) return;
        this.status.set(status);
        this.load();
    }

    /**
     * Re-run the current query from page 1.
     *
     * Goes through `grid.reload()` rather than calling the API directly, so the
     * grid re-emits `(loadMore)` carrying its CURRENT filters and sort. Fetching
     * here instead would quietly drop them — the page does not own that state.
     */
    private load(): void {
        this.loading.set(true);
        this.selectedRow.set(null);
        this.grid?.reload();
    }

    /** Routes the grid's context-menu actions to the bucket transitions / detail view. */
    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const lead = event.row as unknown as LeadDto;
        if (!lead?.id) return;
        switch (event.action) {
            case 'open':   this.openDetail(lead);     break;
            case 'handle': this.act(lead, 'handle'); break;
            case 'reopen': this.act(lead, 'reopen'); break;
            case 'spam':   this.markSpam(lead);      break;
        }
    }

    /** Open the lead's detail page (`/admin/leads/:id`). */
    private openDetail(l: LeadDto): void {
        void this.router.navigate(['/leads', l.id]);
    }

    private markSpam(l: LeadDto): void {
        this.confirmSvc.open({
            title:        'Mark as spam',
            message:      `Move the lead from "${l.name}" to the spam queue?`,
            confirmLabel: 'Mark spam',
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.act(l, 'spam'));
    }

    private act(l: LeadDto, kind: 'handle' | 'spam' | 'reopen'): void {
        if (this.busyIds().has(l.id)) return;
        this.setBusy(l.id, true);
        const call =
            kind === 'handle' ? this.api.handle(l.id) :
            kind === 'spam'   ? this.api.spam(l.id)   :
                                this.api.reopen(l.id);
        call.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                // The lead left the current bucket — drop it from this view AND
                // from the server's count, or the footer would keep claiming a
                // row the queue no longer holds. Cheaper and less jarring than a
                // full reload, which would discard the loaded window.
                this.leads.update(list => list.filter(x => x.id !== l.id));
                this.totalItems.update(n => Math.max(0, n - 1));
                this.selectedRow.set(null);
                this.setBusy(l.id, false);
                this.toast.success(this.successMessage(kind));
            },
            error: () => {
                this.setBusy(l.id, false);
                this.toast.error('Action failed — please retry');
            },
        });
    }

    private successMessage(kind: 'handle' | 'spam' | 'reopen'): string {
        switch (kind) {
            case 'handle': return 'Lead marked handled';
            case 'spam':   return 'Lead marked as spam';
            default:       return 'Lead reopened';
        }
    }

    private setBusy(id: string, busy: boolean): void {
        this.busyIds.update(set => {
            const next = new Set(set);
            if (busy) next.add(id); else next.delete(id);
            return next;
        });
    }
}
