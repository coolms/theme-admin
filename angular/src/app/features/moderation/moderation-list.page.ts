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
import { Store } from '@ngxs/store';
import { filter } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    CmsListPageComponent,
    ConfirmDialogService,
    DataGridComponent,
    PageTitleService,
    ToastService,
    type DataGridData,
} from '@coolms/ui-angular';
import { ModerationService, PendingCommentDto } from './moderation.service';

/** Rows per lazy page — matches the grid YAML's `dataSource.pageSize`. */
const PAGE_SIZE = 50;

/**
 * W7.d — Comment moderation admin page (/admin/moderation).
 *
 * The queue of comments awaiting a decision, surfaced as a `<coolms-datagrid>` (config from
 * the `comment:moderation` YAML, data fed as `externalData`) for visual
 * consistency with Leads / Forms / Cockpit. The grid's rich cells surface the
 * commenter (avatar), the comment body (clamped snippet) and the status
 * (coloured badge); per-row Approve / Reject actions live in the right-click
 * context menu, gated by each row's `status` (house style —
 * `showActionColumn: false`). Plain-text fields are auto-escaped by Angular
 * interpolation — no XSS sink.
 *
 * **`loadingMode: lazy` since #1724.** It used to be `client` — the whole queue
 * in one request, filtered in the browser — but the endpoint capped that at 200
 * rows. A drained queue hid the problem entirely; a spam flood, the one time a
 * moderator needs to filter the whole backlog, is exactly when it broke. Rows
 * now arrive a page at a time through `(loadMore)`, which is also the single
 * entry point for a filter change, a sort change and a refresh.
 *
 * The Comment backend exposes only approve/reject — there is no spam transition
 * — so those are the only two actions.
 *
 * Complementary to the W7.c Inbox dogfood: the same `CommentService` backs both
 * this direct queue and the `comment.moderation` workflow tasks.
 */
@Component({
    selector: 'coolms-admin-moderation-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsListPageComponent, DataGridComponent],
    template: `
        <cms-list-page
            title="Comment moderation"
            icon="chat-square-text"
            subtitle="Review comments awaiting approval"
            toolbarTreeSlug="navi.toolbar.comment.moderation"
            [toolbarContext]="toolbarContext()"
            [footerCount]="footerLabel()"
            (actionClick)="onToolbarAction($event)">
            <coolms-datagrid
                gridId="comment:moderation"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (loadMore)="onLoadMore($event)"
                (rowSelected)="selectedRow.set($event)"
                (rowActionTriggered)="onRowAction($event)">
            </coolms-datagrid>
        </cms-list-page>
    `,
    styles: [':host { display: flex; flex-direction: column; flex: 1; min-height: 0; }'],
})
export class ModerationListComponent implements OnInit {
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    private readonly api        = inject(ModerationService);
    private readonly store      = inject(Store);
    private readonly toast      = inject(ToastService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);

    readonly comments = signal<PendingCommentDto[]>([]);
    readonly loading  = signal(true);
    /** Server's count for the CURRENT filter — drives the footer and `hasMore`. */
    readonly totalItems = signal(0);
    /** Flips true after the first response (success OR error) so the footer stops hiding. */
    readonly loaded = signal(false);

    /** Guards against out-of-order responses; see {@link onLoadMore}. */
    private loadEpoch = 0;
    /** Ids with an in-flight approve/reject — blocks double-submit. */
    private readonly busyIds = signal<ReadonlySet<string>>(new Set());

    /** Selected grid row — drives the toolbar's selection-gated Approve / Reject (navi showWhen). */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * showWhen context for the `navi.toolbar.comment.moderation` tree:
     * `_selected` gates the row actions; `_status` hides them once the comment
     * has left the pending queue (mirrors the grid rowActions).
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
        const rows = this.comments();
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
     * Footer row-count strip (bottom-left) — the SERVER's count for the active
     * filter, so it no longer silently means "rows I happened to load".
     */
    readonly footerLabel = computed(() => {
        if (!this.loaded()) return '';
        const n = this.totalItems();
        // Say nothing at zero: the grid's own empty state distinguishes "queue
        // drained" from "no matches", and the footer cannot tell them apart.
        if (n === 0) return '';

        return `${n} comment${n === 1 ? '' : 's'} awaiting moderation`;
    });

    ngOnInit(): void {
        this.titleSvc.set('Comment moderation');
        // No fetch here — the grid emits `(loadMore)` on mount, which is the
        // single entry point. Fetching here too would race and double-load.
    }

    /**
     * The one place the queue is fetched. Fired on mount, on every filter/sort
     * change (`reset`, offset 0), when the lazy sentinel scrolls in, and — via
     * `grid.reload()` — on a manual refresh.
     *
     * `columnFilters` is passed VERBATIM: the endpoint is RQL-native and its
     * allowlist comes from the same `comment:moderation` YAML that renders the
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
            page,
            pageSize: PAGE_SIZE,
            sort:     event.sort,
            filters:  event.columnFilters,
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: result => {
                // Filter changes fire in quick succession and can land out of
                // order; a stale response would show rows for a filter the user
                // has already moved off.
                if (epoch !== this.loadEpoch) return;

                this.comments.set(event.reset ? result.items : [...this.comments(), ...result.items]);
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
                this.toast.error('Failed to load the moderation queue');
            },
        });
    }

    /** Toolbar actions: Refresh + the selection-gated Approve / Reject mirrors. */
    onToolbarAction(id: string): void {
        if (id === 'refresh') { this.load(); return; }
        const comment = this.selectedRow() as unknown as PendingCommentDto | null;
        if (!comment?.id) return;
        if (id === 'approve') this.act(comment, 'approve');
        if (id === 'reject')  this.confirmReject(comment);
    }

    /** Routes the grid's context-menu actions to the moderation decisions. */
    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const comment = event.row as unknown as PendingCommentDto;
        if (!comment?.id) return;
        switch (event.action) {
            case 'approve': this.act(comment, 'approve'); break;
            case 'reject':  this.confirmReject(comment);  break;
        }
    }

    private confirmReject(c: PendingCommentDto): void {
        this.confirmSvc.open({
            title:        'Reject comment',
            message:      `Reject the comment by "${c.authorName}"? It stays hidden from the post.`,
            confirmLabel: 'Reject',
        }).pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.act(c, 'reject'));
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

    private act(c: PendingCommentDto, kind: 'approve' | 'reject'): void {
        if (this.busyIds().has(c.id)) return;
        this.setBusy(c.id, true);
        const call = kind === 'approve' ? this.api.approve(c.id) : this.api.reject(c.id);
        call.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                // The comment left the pending queue — drop it from this view.
                this.comments.update(list => list.filter(x => x.id !== c.id));
                this.totalItems.update(n => Math.max(0, n - 1));
                this.selectedRow.set(null);
                this.setBusy(c.id, false);
                this.toast.success(kind === 'approve' ? 'Comment approved' : 'Comment rejected');
            },
            error: () => {
                this.setBusy(c.id, false);
                this.toast.error(`Failed to ${kind} the comment`);
            },
        });
    }

    private setBusy(id: string, busy: boolean): void {
        this.busyIds.update(set => {
            const next = new Set(set);
            if (busy) next.add(id); else next.delete(id);
            return next;
        });
    }
}
