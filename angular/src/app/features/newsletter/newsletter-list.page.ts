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
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { forkJoin } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    DataGridComponent,
    PageTitleService,
    TabStripComponent,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { NewsletterComposeDialogComponent } from './newsletter-compose-dialog.component';
import { SubscriberDto, SubscriptionStatus, NewsletterService } from './newsletter.service';

/** Rows per lazy page — matches the grid YAML's `dataSource.pageSize`. */
const PAGE_SIZE = 50;

/**
 * Rows per request when exporting. Larger than the grid page because an export
 * is one deliberate bulk read, and fewer round-trips beats a smoother scroll.
 */
const EXPORT_PAGE_SIZE = 200;

interface StatusTab {
    readonly id:    SubscriptionStatus;
    readonly label: string;
    readonly icon:  string;
}

/**
 * W8 — Newsletter admin page (/admin/newsletter).
 *
 * Subscribers list for a status bucket (Confirmed default, Pending,
 * Unsubscribed), rendered as a `<coolms-datagrid>` (config from the
 * `newsletter:list` YAML, data fed as `externalData`) for visual consistency
 * with Leads / Forms / Cockpit. The grid's rich cells surface the subscriber
 * (avatar + signup source, with a one-click mailto available via the column
 * chooser), the status (coloured badge) and the subscribed / confirmed dates.
 *
 * **Compose** lives behind the header "Compose" toolbar action — it opens the
 * standalone `app-newsletter-compose-dialog` (Option A, #974), seeded with the
 * confirmed-recipient count, which collects subject + HTML body and POSTs to
 * `/newsletter/campaigns` (the backend fans the send out asynchronously and
 * replies with the authoritative queued count). The "export" action writes a
 * CSV of the WHOLE bucket — see {@link exportCsv}.
 *
 * The Newsletter backend exposes no per-subscriber admin mutation (only list +
 * send-campaign), so the grid is display-only — there are no row actions.
 *
 * **`loadingMode: lazy` since #1724.** It used to be `client` — one request per
 * tab, whole bucket, filtered in the browser — but the endpoint capped that at
 * 200 rows, so the list silently omitted subscribers past the cap AND every
 * filter searched a truncated window while presenting itself as complete. Rows
 * now arrive a page at a time through `(loadMore)`, which is also the ONE entry
 * point for a filter change, a sort change and a tab switch.
 */
@Component({
    selector: 'coolms-admin-newsletter',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent, TabStripComponent],
    template: `
        <cms-list-page
            title="Newsletter"
            icon="envelope-paper"
            subtitle="Manage subscribers and send campaigns"
            toolbarTreeSlug="navi.toolbar.newsletter.list"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <div class="cms-news">
                <section class="cms-news__list">
                    <app-tab-strip
                        [tabs]="tabs"
                        [activeId]="status()"
                        (selected)="selectTab($any($event))" />

                    <coolms-datagrid
                        gridId="newsletter:list"
                        [configBaseUrl]="configBaseUrl()"
                        [externalData]="gridData()"
                        (loadMore)="onLoadMore($event)">
                    </coolms-datagrid>
                </section>
            </div>
        </cms-list-page>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .cms-news {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
        .cms-news__list {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
    `],
})
export class NewsletterListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    private readonly api        = inject(NewsletterService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly dialog     = inject(Dialog);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly tabs: StatusTab[] = [
        { id: 'confirmed',    label: 'Confirmed',    icon: 'check2-circle' },
        { id: 'pending',      label: 'Pending',      icon: 'hourglass-split' },
        { id: 'unsubscribed', label: 'Unsubscribed', icon: 'person-dash' },
    ];

    readonly status      = signal<SubscriptionStatus>('confirmed');
    readonly subscribers = signal<SubscriberDto[]>([]);
    readonly loading     = signal(true);
    /**
     * Confirmed-bucket recipient count for the compose dialog.
     *
     * Now the SERVER's count (#1724). It used to be `rows.length` off a list the
     * endpoint capped at 200, so a campaign to 5,000 confirmed subscribers
     * announced "200 recipients" in the compose dialog.
     */
    readonly confirmedCount = signal(0);
    /** Server's count for the CURRENT bucket + filter — drives the footer and `hasMore`. */
    readonly totalItems = signal(0);
    /** Flips true after the first response (success OR error) so the footer stops hiding. */
    readonly loaded = signal(false);

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;

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
        const rows = this.subscribers();
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
     * Footer row-count strip (bottom-left) — the SERVER's count for the bucket
     * and active filter, so it no longer silently means "rows I happened to
     * load".
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        const bucket = this.status();
        // Say nothing at zero: the grid's own empty state distinguishes "none in
        // this bucket" from "no matches", and the footer cannot tell them apart.
        if (n === 0) return '';

        return `${n} ${bucket} subscriber${n === 1 ? '' : 's'}`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Newsletter');
        // No fetch here — the grid emits `(loadMore)` on mount, which is the
        // single entry point. Fetching here too would race and double-load.
    }

    /**
     * The one place subscribers are fetched. Fired on mount, on every
     * filter/sort change (`reset`, offset 0), when the lazy sentinel scrolls in,
     * and — via `grid.reload()` — on a tab switch or a manual refresh.
     *
     * `columnFilters` is passed VERBATIM: the endpoint is RQL-native and its
     * allowlist comes from the same `newsletter:list` YAML that renders the
     * filter row.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        const status = this.status();
        const page   = Math.floor(event.offset / PAGE_SIZE) + 1;
        const epoch  = ++this.loadEpoch;

        this.api.listPage({
            status,
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

                this.subscribers.set(event.reset ? result.items : [...this.subscribers(), ...result.items]);
                this.totalItems.set(result.totalItems);
                this.loading.set(false);
                this.loaded.set(true);
                // Keep the compose recipient count fresh whenever the confirmed
                // bucket loads — and unfiltered, since a campaign goes to the
                // whole bucket rather than to what the grid is showing.
                if (status === 'confirmed' && event.columnFilters.length === 0) {
                    this.confirmedCount.set(result.totalItems);
                }
            },
            error: () => {
                if (epoch !== this.loadEpoch) return;
                // Settle `hasMore` on failure too, or the sentinel retries the
                // failed page forever.
                this.loading.set(false);
                this.loaded.set(true);
                this.toast.error('Failed to load subscribers');
            },
        });
    }

    onToolbarAction(id: string): void {
        if (id === 'compose') this.openCompose();
        if (id === 'refresh') this.load();
        if (id === 'export')  this.exportCsv();
    }

    selectTab(status: SubscriptionStatus): void {
        if (this.status() === status) return;
        this.status.set(status);
        this.load();
    }

    /** Open the Compose campaign modal; refresh the confirmed bucket if a send was queued. */
    private openCompose(): void {
        this.dialog.open<boolean>(NewsletterComposeDialogComponent, {
            data: this.confirmedCount(),
        }).closed.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(sent => {
            if (sent && this.status() === 'confirmed') this.load();
        });
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
        this.grid?.reload();
    }

    /**
     * Export the WHOLE bucket, not the loaded window.
     *
     * With lazy loading `subscribers()` holds only what has been scrolled into
     * view, so exporting it would silently produce a 50-row CSV of a 5,000-row
     * list — a worse version of the bug this slice fixes. So the export fetches
     * every page first. It is a deliberate, user-initiated bulk read: the one
     * place asking the server for everything is the correct thing to do.
     */
    private exportCsv(): void {
        if (this.totalItems() === 0) {
            this.toast.error('Nothing to export in this view.');
            return;
        }

        const status = this.status();
        const pages = Math.max(1, Math.ceil(this.totalItems() / EXPORT_PAGE_SIZE));

        forkJoin(
            Array.from({ length: pages }, (_, i) =>
                this.api.listPage({ status, page: i + 1, pageSize: EXPORT_PAGE_SIZE })),
        ).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: results => this.downloadCsv(results.flatMap(r => r.items), status),
            error: () => this.toast.error('Export failed — please retry'),
        });
    }

    /** @param rows every subscriber in the bucket, not just the loaded window. */
    private downloadCsv(rows: readonly SubscriberDto[], status: SubscriptionStatus): void {
        const header = ['Email', 'Status', 'Source', 'Subscribed', 'Confirmed'];
        const lines = rows.map(s => [
            s.email, s.status, s.source ?? '', s.createdAt, s.confirmedAt ?? '',
        ]);
        const csv = [header, ...lines]
            .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `newsletter-${status}-subscribers.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
