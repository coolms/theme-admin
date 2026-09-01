import { CommonModule } from '@angular/common';
import { CmsDropzoneDirective, CmsItemInteractionsDirective, ContextMenuService, DataGridComponent, DataGridData, PageFooterService, type CmsDropzoneConfig, type CmsSelectionChange } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    OnDestroy,
    ViewChild,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, interval, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import {
    DocumentInstance,
    DocumentInstanceService,
    type InstanceScope,
} from '@coolms/document-angular';

import { Store } from '@ngxs/store';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
import { ApiService, NodeDto } from '../../../api/api.service';
import { DocumentPageStateService, type InstanceFilters } from './document-page-state.service';
import { filenameOf, formatLocation } from './vfs-location.helpers';
import { filterTreeDirectories } from './vfs-tree.helpers';

/**
 * Phase A.1a — instances file zone.
 *
 * Mounts in the main slot when `state.rightPanelMode === 'instances'`,
 * spans the full middle+right area (the right detail panel collapses
 * via `pageContext.activeItem === null`). Filter UI lives in the page
 * toolbar's `[toolbar-filters]` projection — this component reads
 * `state.instanceFilters()` directly.
 *
 * Two view modes (driven by `state.instancesViewMode()`):
 *   - `grid` (default): file-card tiles
 *   - `list`: sortable table with a Location column derived from
 *     `formatLocation(vfsPath)`
 *
 * Pagination: 50 rows per request, lazy-loaded as the bottom sentinel
 * enters the viewport. Polling: 3 s tick refreshes the visible window
 * while any row is `pending`. TODO(centrifugo): replace polling with a
 * per-template subscription channel once real-time lands.
 */
type SortKey = 'generatedAt' | 'outputFormat' | 'status' | 'name';
type SortDir = 'asc' | 'desc';

@Component({
    selector: 'cms-instances-browser',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        CmsItemInteractionsDirective,
        CmsDropzoneDirective,
        DataGridComponent,
        CmsLoaderComponent,
    ],
    template: `
        <!-- #1684 — the documents file zone is a real file zone: it takes
             a right-click (background actions) and an OS file drop, the
             same affordances the templates zone has always had. Both are
             gated on the path scope, since a template's instances view
             is a projection, not a folder you can put things in. -->
        <div class="cms-instances-zone"
             [attr.data-view-mode]="viewMode()"
             [cmsDropzone]="dropzoneConfig()"
             (contextmenu)="onBackgroundContextMenu($event)"
             (filesDropped)="onFilesDropped($event)">
            <!-- #1683 — the way back to Templates. Sits ABOVE the
                 mode-dependent body on purpose, so it is present in
                 grid, list, empty AND filtered-empty states: in the
                 space scope the root is the last breadcrumb segment
                 and therefore not a link, so if this tile were inside
                 the grid branch an empty space would be a dead end. -->
            @if (pathScope()) {
                <nav class="cms-instances-zone__folders" aria-label="Folders">
                    <button type="button"
                            class="cms-folder-chip"
                            title="Open Templates"
                            (click)="onOpenTemplates()">
                        <i class="bi bi-folder-fill cms-folder-chip__icon"></i>
                        <span class="cms-folder-chip__name">Templates</span>
                    </button>
                    <!-- Direct children only. The listing below is
                         non-recursive to match, so a document filed
                         into one of these leaves the parent. -->
                    @for (folder of subfolders(); track folder.path) {
                        <!-- Display name over the on-disk name (#1685):
                             the directory is a slug, the title is what
                             the user typed. Tooltip keeps the real path
                             visible so the two are never confused. -->
                        <button type="button"
                                class="cms-folder-chip"
                                [title]="folder.path"
                                (click)="onOpenFolder(folder.path)">
                            <i class="bi bi-folder-fill cms-folder-chip__icon"></i>
                            <span class="cms-folder-chip__name">{{ folder.title || folder.name }}</span>
                        </button>
                    }
                </nav>
            }
            @if (loading() && instances().length === 0) {
                <div class="cms-instances-zone__status cms-instances-zone__status--loading">
                    <cms-loader label="Loading documents" />
                </div>
            } @else if (errorMessage()) {
                <div class="cms-instances-zone__status cms-instances-zone__status--error">
                    {{ errorMessage() }}
                </div>
            } @else if (instances().length === 0 && hasFilters()) {
                <div class="cms-instances-zone__empty" [attr.data-selectable]="''">
                    <i class="bi bi-funnel cms-instances-zone__empty-icon"></i>
                    <h3>No instances match the filters</h3>
                    <button type="button" class="cms-btn" (click)="clearFilters()">Clear filters</button>
                </div>
            } @else if (instances().length === 0 && pathScope()) {
                <div class="cms-instances-zone__empty" [attr.data-selectable]="''">
                    <i class="bi bi-file-earmark-text cms-instances-zone__empty-icon"></i>
                    <h3>No documents in this folder yet</h3>
                    <!-- No Generate button here: generating needs a template,
                         and in the space scope none is selected. Open
                         Templates, pick one, generate from there. -->
                    <p>Upload one, or open Templates and generate from one of them.</p>
                </div>
            } @else if (instances().length === 0) {
                <div class="cms-instances-zone__empty" [attr.data-selectable]="''">
                    <i class="bi bi-file-earmark-text cms-instances-zone__empty-icon"></i>
                    <h3>No instances yet</h3>
                    <p>Generate your first document from this template.</p>
                    <div class="cms-instances-zone__empty-actions">
                        <button type="button" class="cms-btn cms-btn-primary" (click)="onGenerate()">
                            <i class="bi bi-file-earmark-arrow-down"></i>
                            <span>Generate</span>
                        </button>
                    </div>
                </div>
            } @else if (viewMode() === 'details') {
                <!-- #1709 — the platform DataGrid, config at
                     /api/v1/datagrids/document:instances. Replaces a table
                     whose five headers hand-rolled sorting and whose filtering
                     lived in two toolbar selects; the grid does both, per
                     column, and lets the user pick which columns exist. -->
                <coolms-datagrid
                    gridId="document:instances"
                    [configBaseUrl]="configBaseUrl()"
                    [externalData]="gridData()"
                    (rowSelected)="onGridRowSelected($event)"
                    (rowActivated)="onGridRowActivated($event)"
                    (rowContextMenu)="onGridRowContextMenu($event)"
                    (backgroundContextMenu)="onBackgroundContextMenu($event)">
                </coolms-datagrid>
            } @else {
                <div class="cms-instances-zone__grid" [attr.data-selectable]="''">
                    @for (instance of instances(); track instance.id) {
                        <article
                            class="cms-instance-card"
                            [class.cms-instance-card--selected]="isSelected(instance)"
                            [class.cms-instance-card--pending]="instance.status === 'pending'"
                            [class.cms-instance-card--failed]="instance.status === 'failed'"
                            [title]="rowTitle(instance)"
                            cmsItemInteractions
                            [cmsItem]="instance"
                            [currentSelection]="currentSelectionArray()"
                            (selectionChanged)="onSelectionChanged($event)"
                            (activated)="onActivate($event)"
                            (contextMenuRequested)="onContextMenu($event)"
                        >
                            <i class="cms-instance-card__icon bi"
                               [class]="iconClassFor(instance)"
                               [style.color]="iconColorFor(instance)"></i>
                            <h4 class="cms-instance-card__name">{{ filenameFor(instance) }}</h4>
                            <div class="cms-instance-card__badges">
                                <span class="cms-instance-card__badge cms-instance-card__badge--format">
                                    {{ instance.outputFormat | uppercase }}
                                </span>
                                <span class="cms-instance-card__badge cms-instance-card__badge--status"
                                      [attr.data-status]="instance.status">
                                    {{ instance.status }}
                                </span>
                            </div>
                        </article>
                    }
                </div>
            }

            @if (loadingMore()) {
                <div class="cms-instances-zone__status cms-instances-zone__status--inline">
                    <cms-loader [inline]="true" />
                    <span>Loading more…</span>
                </div>
            }
            <div #sentinel class="cms-instances-zone__sentinel"></div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
            min-height: 0;
        }
        .cms-instances-zone {
            height: 100%;
            overflow-y: auto;
            padding: var(--cms-content-padding);
        }
        .cms-instances-zone__status {
            color: var(--cms-text-muted);
            display: flex;
            align-items: center;
            gap: 8px;
            padding: var(--cms-panel-padding) 0;
        }
        /* Same correction as the folder pane: the status row is a line of text,
           and a first-load mark is the pane's whole content. The zone is a
           BLOCK with height:100%, so min-height:100% (border-box, so the zone's
           own padding is inside it) fills it where flex:1 cannot. */
        .cms-instances-zone__status--loading {
            box-sizing: border-box;
            min-height: 100%;
            justify-content: center;
        }
        .cms-instances-zone__status--inline {
            justify-content: center;
            font-size: 0.8rem;
        }
        .cms-instances-zone__status--error {
            color: var(--cms-danger, #dc2626);
        }
        .cms-instances-zone__empty {
            text-align: center;
            padding: 48px 16px;
            color: var(--cms-text-muted);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }
        .cms-instances-zone__empty-icon {
            font-size: 3rem;
            color: var(--cms-text-muted);
        }
        .cms-instances-zone__empty h3 {
            margin: 8px 0 4px;
            color: var(--cms-text);
            font-size: 1.05rem;
        }
        .cms-instances-zone__empty-actions {
            display: inline-flex;
            gap: 8px;
            margin-top: 4px;
            flex-wrap: wrap;
            justify-content: center;
        }

        /* ── Tile views ─────────────────────────────────────────── */
        .cms-instances-zone__grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: var(--cms-panel-padding);
        }
        /* #1709 — one card, three sizes, keyed off the shared vocabulary on
           the zone wrapper. "large" is the untouched default. */
        .cms-instances-zone[data-view-mode='small'] .cms-instances-zone__grid {
            grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
            gap: 10px;
        }
        .cms-instances-zone[data-view-mode='small'] .cms-instance-card__badges {
            display: none;
        }
        .cms-instances-zone[data-view-mode='content'] .cms-instances-zone__grid {
            grid-template-columns: 1fr;
            gap: 6px;
        }
        .cms-instances-zone[data-view-mode='content'] .cms-instance-card {
            flex-direction: row;
            align-items: center;
            gap: 12px;
            text-align: left;
        }
        /* #1683 — Templates folder strip. A chip rather than a full
           card in the grid: it is navigation, not one of the listed
           documents, and it has to read the same in list mode where
           there is no card grid at all. */
        .cms-instances-zone__folders {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding-bottom: var(--cms-panel-padding);
            margin-bottom: var(--cms-panel-padding);
            border-bottom: 1px solid var(--cms-border);
        }
        .cms-folder-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
            color: var(--cms-text);
            font: inherit;
            cursor: pointer;
        }
        .cms-folder-chip:hover {
            border-color: var(--cms-primary);
            background: var(--cms-surface-hover, var(--cms-surface));
        }
        .cms-folder-chip__icon {
            color: var(--cms-filetype-directory, #f59e0b);
            font-size: 1.05rem;
        }
        .cms-folder-chip__name {
            font-weight: 500;
        }
        .cms-instance-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 16px 12px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            cursor: pointer;
            text-align: center;
            transition: border-color 0.1s, box-shadow 0.1s;
        }
        .cms-instance-card:hover {
            border-color: var(--cms-text-muted);
            box-shadow: var(--cms-shadow-sm);
        }
        .cms-instance-card--selected {
            border-color: var(--cms-text-secondary);
            box-shadow: var(--cms-shadow-md);
        }
        .cms-instance-card--pending {
            opacity: 0.75;
        }
        .cms-instance-card--failed {
            border-color: var(--cms-danger, #dc2626);
        }
        .cms-instance-card__icon {
            font-size: 2.5rem;
            line-height: 1;
        }
        .cms-instance-card__name {
            margin: 4px 0 0;
            font-size: 0.85rem;
            font-weight: 500;
            word-break: break-word;
            color: var(--cms-text);
        }
        .cms-instance-card__badges {
            display: flex;
            gap: 4px;
            justify-content: center;
            flex-wrap: wrap;
            margin-top: 2px;
        }
        .cms-instance-card__badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            background: var(--cms-border-light);
            font-size: 0.7rem;
            text-transform: lowercase;
            color: var(--cms-text-secondary);
        }
        .cms-instance-card__badge--format {
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-weight: 500;
        }
        .cms-instance-card__badge--status[data-status="rendered"] {
            background: var(--cms-success-light);
            color: var(--cms-success-text);
        }
        .cms-instance-card__badge--status[data-status="failed"] {
            background: var(--cms-danger-light);
            color: var(--cms-danger-text);
        }
        /* #1684 — uploaded, i.e. not produced here at all. Deliberately
           neutral rather than another success colour: it is a statement
           of origin, not of outcome. */
        .cms-instance-card__badge--status[data-status="uploaded"] {
            background: var(--cms-info-light);
            color: var(--cms-info-text);
        }

        /* ── List view ──────────────────────────────────────────── */
        .cms-instances-zone__table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
        }
        .cms-instances-zone__th {
            text-align: left;
            font-weight: 500;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            border-bottom: 1px solid var(--cms-border);
            padding: 8px;
            cursor: pointer;
            user-select: none;
            background: var(--cms-surface);
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .cms-instances-zone__th--unsortable {
            cursor: default;
        }
        .cms-instances-zone__th:hover:not(.cms-instances-zone__th--unsortable) {
            color: var(--cms-text);
        }
        .cms-instances-zone__th--sorted {
            color: var(--cms-text);
        }
        .cms-instances-zone__th i {
            margin-left: 4px;
            font-size: 0.7rem;
        }
        .cms-instances-zone__row {
            cursor: pointer;
            border-bottom: 1px solid var(--cms-border-light);
        }
        .cms-instances-zone__row:hover {
            background: var(--cms-border-light);
        }
        .cms-instances-zone__row--selected {
            background: var(--cms-border-light);
            font-weight: 500;
        }
        .cms-instances-zone__row--pending {
            opacity: 0.75;
        }
        .cms-instances-zone__row--failed {
            color: var(--cms-danger, #dc2626);
        }
        .cms-instances-zone__row td {
            padding: 8px;
        }
        .cms-instances-zone__name {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .cms-instances-zone__location {
            font-family: var(--cms-font-mono, ui-monospace, SFMono-Regular, monospace);
            font-size: 0.8rem;
            color: var(--cms-text-muted);
        }
        .cms-instances-zone__badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: var(--cms-radius-sm);
            background: var(--cms-border-light);
            font-size: 0.75rem;
            text-transform: lowercase;
        }
        .cms-instances-zone__badge[data-status="rendered"] {
            background: var(--cms-success-light);
            color: var(--cms-success-text);
        }
        .cms-instances-zone__badge[data-status="failed"] {
            background: var(--cms-danger-light);
            color: var(--cms-danger-text);
        }
        .cms-instances-zone__badge[data-status="uploaded"] {
            background: var(--cms-info-light);
            color: var(--cms-info-text);
        }
        .cms-instances-zone__muted {
            color: var(--cms-text-muted);
        }
        .cms-instances-zone__sentinel {
            height: 1px;
        }
    `],
})
export class InstancesBrowserComponent implements AfterViewInit, OnDestroy {
    readonly template = input.required<DocumentTemplate | null>();

    /**
     * #1683 — when set, this browser lists everything produced at or
     * below one VFS root instead of everything produced by one
     * template, and `template()` is ignored. See `scope()`.
     */
    readonly pathScope = input<string | null>(null);

    /**
     * The single question this view is answering. Every fetch, guard
     * and poll reads THIS rather than `template()` — the two scopes
     * differ only in the filter predicate, so keeping one code path
     * means the open / download / regenerate / delete behaviour fixed
     * in #1670 and #1682 can't fork between them.
     */
    protected readonly scope = computed<InstanceScope | null>(() => {
        const path = this.pathScope();
        if (path !== null && path !== '') {
            return { path };
        }
        const tpl = this.template();
        return tpl ? { templateId: tpl.id } : null;
    });

    @ViewChild('sentinel') sentinelEl?: ElementRef<HTMLDivElement>;

    private readonly api = inject(ApiService);
    private readonly instancesSvc = inject(DocumentInstanceService);
    private readonly state = inject(DocumentPageStateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly footer = inject(PageFooterService);
    private readonly store = inject(Store);

    /**
     * Direct child directories of the scoped folder, for the chip strip
     * (#1684). Sourced from the VFS rather than the instances endpoint —
     * a folder is not a document, and an empty one still has to be
     * reachable. `filterTreeDirectories` also drops `.templates`, which
     * gets its own chip and is a security gate, not a subfolder.
     */
    protected readonly subfolders = signal<readonly NodeDto[]>([]);

    protected readonly instances = signal<DocumentInstance[]>([]);
    protected readonly loading = signal(false);
    protected readonly loadingMore = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly allLoaded = signal(false);
    protected readonly sortKey = signal<SortKey>('generatedAt');
    protected readonly sortDir = signal<SortDir>('desc');

    protected readonly filters = computed<InstanceFilters>(() => this.state.instanceFilters());
    protected readonly viewMode = computed(() => this.state.instancesViewMode());

    /** Where the grid fetches its column config from (#1709). */
    protected readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * The loaded window, shaped for the DataGrid (#1709).
     *
     * `name` and `location` are DERIVED here, not sent by the API: the
     * filename falls back through `vfsPath` for rows generated before the
     * display-name column existed, and the location is a formatted path. The
     * grid renders values, so the derivation has to happen before it, and it
     * has to be the SAME derivation the tiles use or the two views would
     * disagree about what a file is called.
     *
     * `totalItems` is the server's count, not the loaded length — the footer
     * and the grid both read it, and reporting the window as the total would
     * claim a partly-loaded list is complete.
     */
    protected readonly gridData = computed((): DataGridData => {
        const items = this.instances().map(instance => ({
            ...instance,
            name: this.filenameFor(instance),
            location: this.locationFor(instance),
        }));

        return {
            items,
            totalItems: this.state.instanceCount(),
            page:       1,
            limit:      items.length,
            totalPages: 1,
            // The zone's own scroll sentinel appends the next page into
            // `instances()`, so the grid always holds everything loaded so
            // far. Claiming more would give it a pager that fights the
            // sentinel for the same fetch.
            hasMore:    false,
        };
    });

    private readonly pageSize = 50;
    private currentPage = 1;
    private observer: IntersectionObserver | null = null;
    private readonly cancel$ = new Subject<void>();

    constructor() {
        // #1684 — subfolder chips follow the scoped folder. Kept separate
        // from the instance fetch: filters and sort must not change which
        // folders exist.
        effect(() => {
            const path = this.pathScope();
            this.state.folderVersion();
            if (null === path || '' === path) {
                this.subfolders.set([]);

                return;
            }
            this.api
                .listDirectory(path)
                .pipe(
                    catchError(() => of<NodeDto[]>([])),
                    takeUntilDestroyed(this.destroyRef),
                )
                .subscribe((nodes) => this.subfolders.set(filterTreeDirectories(nodes)));
        });

        // Refetch from page 1 whenever the scope / filters / sort change.
        effect(() => {
            const scope = this.scope();
            const f = this.filters();
            this.sortKey();
            this.sortDir();
            if (scope) {
                this.resetAndFetch(scope);
            } else {
                this.cancel$.next();
                this.instances.set([]);
                this.allLoaded.set(true);
            }
            void f;
        });

        // Polling tick — runs only while there's at least one pending
        // row. TODO(centrifugo): replace this poll with a per-template
        // subscription channel once the real-time bridge lands.
        interval(3000)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (!this.scope()) {
                    return;
                }
                if (this.instances().some((i) => i.status === 'pending')) {
                    this.refetchVisible();
                }
            });

        // Phase A.1b backend ops: explicit refresh trigger from
        // delete/regenerate handlers. Refetches in place to preserve
        // the user's scroll position.
        this.state.refreshInstancesRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refetchVisible());

        // Phase D: push the loaded/total count into the page footer so
        // the bottom status bar is consistent with Media Library / DataGrid
        // pages. The inline "All N loaded" text under the grid was
        // removed in favour of this single footer slot.
        effect(() => {
            const loaded = this.instances().length;
            const total = this.state.instanceCount();
            const fullyLoaded = this.allLoaded();
            if (loaded === 0) {
                this.footer.update({ count: undefined });
                return;
            }
            const noun = (n: number) => `instance${n === 1 ? '' : 's'}`;
            this.footer.update({
                count: fullyLoaded
                    ? `All ${loaded} ${noun(loaded)} loaded`
                    : `Loaded ${loaded} of ${total} ${noun(total)}`,
            });
        });
    }

    ngAfterViewInit(): void {
        if (!this.sentinelEl) {
            return;
        }
        this.observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry?.isIntersecting) {
                return;
            }
            if (this.loading() || this.loadingMore() || this.allLoaded()) {
                return;
            }
            const scope = this.scope();
            if (scope) {
                this.fetchNextPage(scope);
            }
        }, { root: this.sentinelEl.nativeElement.parentElement });
        this.observer.observe(this.sentinelEl.nativeElement);
    }

    ngOnDestroy(): void {
        this.observer?.disconnect();
        this.cancel$.next();
        this.cancel$.complete();
        // Hand off footer ownership: when the next active slot
        // (folder-content) mounts, its effect will overwrite. If
        // nothing else mounts, leave the slot empty rather than
        // showing stale instance-count text.
        this.footer.update({ count: undefined });
    }

    protected hasFilters(): boolean {
        const f = this.filters();
        return f.outputFormat !== null || f.status !== null || f.search.length > 0;
    }

    protected clearFilters(): void {
        this.state.resetInstanceFilters();
    }

    /** Grid selection → the single-instance selection model both views share. */
    protected onGridRowSelected(row: Record<string, unknown> | null): void {
        const instance = null === row ? undefined : this.instanceFor(row);
        this.gridRow = instance ?? null;
        if (instance) {
            this.state.selectInstance(instance);
        }
    }

    /**
     * The row the grid last selected, remembered because the shared state
     * cannot be read back in the same tick (#1710).
     *
     * The grid emits `rowSelected` and then `rowContextMenu` synchronously
     * from one handler, so at right-click time `state.selectedInstance()`
     * still holds the PREVIOUS selection.
     */
    private gridRow: DocumentInstance | null = null;

    /** Double-click in the grid means what it means on a card. */
    protected onGridRowActivated(row: Record<string, unknown>): void {
        const instance = this.instanceFor(row);
        if (instance) {
            this.onActivate(instance);
        }
    }

    /**
     * Right-click inside the grid. The grid emits `rowSelected` first, so the
     * instance under the cursor is already selected — which is why this reads
     * state rather than the event.
     */
    protected onGridRowContextMenu(event: MouseEvent): void {
        const instance = this.gridRow;
        if (instance) {
            this.onContextMenu({ item: instance, event });
        }
    }

    /**
     * The grid hands back the FLATTENED row it was given, not the DTO — the
     * handlers downstream want the instance, so map back by id.
     */
    private instanceFor(row: Record<string, unknown>): DocumentInstance | undefined {
        const id = row['id'];

        return 'string' === typeof id
            ? this.instances().find(i => i.id === id)
            : undefined;
    }

    /**
     * #1683 — leave the space-scoped Documents view for the template
     * listing at the same path. Single click, because this is folder
     * NAVIGATION (same gesture as the folders tree), not selection of
     * an item that a second click would open.
     */
    /**
     * Unlike the templates zone, this accepts ANY file type: "not all
     * the uploaded docs are templates" is the whole point of the
     * Documents view, so restricting to DOCX here would recreate the
     * gap (#1684). Disabled outside the space scope — a template's
     * instances view is a projection, not a folder.
     */
    protected readonly dropzoneConfig = computed<CmsDropzoneConfig>(() => ({
        multiple: true,
        disabled: null === this.pathScope(),
    }));

    protected onFilesDropped(files: File[]): void {
        if (0 === files.length) {
            return;
        }
        this.state.uploadDocumentsRequested$.next(files);
    }

    /**
     * Right-click on empty space in the documents zone. Mirrors
     * `folder-content`'s background menu, which this view simply never
     * had — the file zone offered no menu at all.
     */
    protected onBackgroundContextMenu(event: MouseEvent): void {
        if (null === this.pathScope()) {
            return;
        }
        // A Details-grid ROW is not background (#1710): without this the
        // background menu fires after — and replaces — the instance menu the
        // row handler just opened. The empty area below the rows still is.
        if ((event.target as HTMLElement).closest('coolms-datagrid tbody tr')) {
            return;
        }
        const nodes = this.state.toolbarNodes();
        if (0 === nodes.length) {
            return;
        }
        event.preventDefault();
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            {
                _kind: 'background',
                _selected: false,
                _surface: 'context',
                _view: this.state.browseView(),
            },
            (action) => this.state.dispatchAction(action),
        );
    }

    protected onOpenTemplates(): void {
        this.state.showTemplates();
    }

    /**
     * #1684 — navigate into a subfolder. `selectFolder` moves
     * `currentPath`, and the page's rescope effect re-points the space
     * scope at it, so the listing and the breadcrumb follow together.
     */
    protected onOpenFolder(path: string): void {
        this.state.selectFolder(path);
    }

    protected onGenerate(): void {
        const t = this.template();
        if (t) {
            this.state.selectTemplate(t.id);
            this.state.actionDispatched$.next('generate');
        }
    }

    /**
     * Phase E3 — `CmsItemInteractionsDirective.currentSelection`
     * input. Document holds a single focused instance; derive a
     * single-element array so right-click on the already-selected
     * card skips re-emission.
     */
    protected readonly currentSelectionArray = computed<readonly DocumentInstance[]>(() => {
        const inst = this.state.selectedInstance();
        return inst ? [inst] : [];
    });

    /**
     * Phase E3 — bridge directive emission into single-instance state.
     */
    protected onSelectionChanged(event: CmsSelectionChange<DocumentInstance>): void {
        const item = event.selection[0];
        if (item) {
            this.state.selectInstance(item);
        }
    }

    protected isSelected(instance: DocumentInstance): boolean {
        return this.state.selectedInstance()?.id === instance.id;
    }

    protected onActivate(instance: DocumentInstance): void {
        // Phase D hotfix #4: double-click → primary action (View).
        // Pending / failed instances are no-op (the page handler's
        // `case 'view-instance'` checks `generatedFileId`).
        // #1684 — `uploaded` opens too: what makes a row viewable is
        // bytes on disk, not who wrote them.
        if (!this.isReadable(instance) || !instance.generatedFileId) {
            return;
        }
        this.state.selectInstance(instance);
        this.state.dispatchAction('view-instance');
    }

    /**
     * Right-click on an instance card/row. The directive's
     * `applyRightClick` already updated selection if needed; this
     * handler only owns the NaviGraph context-menu dispatch.
     */
    protected onContextMenu(payload: { item: DocumentInstance; event: MouseEvent }): void {
        this.state.selectInstance(payload.item);
        this.contextMenu.openFromNodes(
            payload.event,
            this.state.toolbarNodes(),
            { _kind: 'instance', _status: payload.item.status, _surface: 'context' },
            (action) => this.state.dispatchAction(action),
        );
    }

    /** Has bytes on disk — the precondition for View and Download. */
    protected isReadable(instance: DocumentInstance): boolean {
        return instance.status === 'rendered' || instance.status === 'uploaded';
    }

    protected rowTitle(instance: DocumentInstance): string {
        if (this.isReadable(instance)) {
            return 'Double-click to preview';
        }
        if (instance.status === 'failed') {
            return instance.errorMessage ?? 'Generation failed';
        }
        return 'Generation in progress…';
    }

    protected filenameFor(instance: DocumentInstance): string {
        const fallback = instance.name && instance.name.length > 0
            ? `${instance.name}.${instance.outputFormat}`
            : `${instance.id.slice(0, 8)}.${instance.outputFormat}`;
        return filenameOf(instance.vfsPath, fallback);
    }

    protected locationFor(instance: DocumentInstance): string {
        return formatLocation(instance.vfsPath);
    }

    protected iconClassFor(instance: DocumentInstance): string {
        switch (instance.outputFormat) {
            case 'docx':
                return 'bi-file-earmark-word';
            case 'pdf':
                return 'bi-file-earmark-pdf';
            default:
                return 'bi-file-earmark';
        }
    }

    protected iconColorFor(instance: DocumentInstance): string {
        switch (instance.outputFormat) {
            case 'docx':
                return '#2b579a';
            case 'pdf':
                return '#d83b01';
            default:
                return 'var(--cms-text-muted)';
        }
    }

    private resetAndFetch(scope: InstanceScope): void {
        this.cancel$.next();
        this.currentPage = 1;
        this.allLoaded.set(false);
        this.instances.set([]);
        this.errorMessage.set(null);
        this.loading.set(true);
        this.fetchPage(scope, 1, /* append */ false);
    }

    private fetchNextPage(scope: InstanceScope): void {
        this.loadingMore.set(true);
        this.currentPage += 1;
        this.fetchPage(scope, this.currentPage, /* append */ true);
    }

    private fetchPage(scope: InstanceScope, page: number, append: boolean): void {
        const f = this.filters();
        this.instancesSvc
            .listInstances(scope, {
                outputFormat: f.outputFormat,
                status: f.status,
                search: f.search || undefined,
                sortKey: this.sortKey(),
                sortDir: this.sortDir(),
                page,
                limit: this.pageSize,
            })
            .pipe(
                takeUntil(this.cancel$),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: ({ items, totalItems }) => {
                    const merged = append ? [...this.instances(), ...items] : items;
                    this.instances.set(merged);
                    this.allLoaded.set(merged.length >= totalItems || items.length < this.pageSize);
                    if (!append) {
                        this.state.setInstanceCount(totalItems);
                    }
                    this.loading.set(false);
                    this.loadingMore.set(false);
                },
                error: (err: Error) => {
                    this.errorMessage.set(err.message ?? 'Failed to load instances.');
                    this.loading.set(false);
                    this.loadingMore.set(false);
                },
            });
    }

    /**
     * Polling refresh: re-fetch the visible window so newly rendered
     * rows replace pending counterparts in place. Doesn't append; the
     * user's scroll position is preserved.
     */
    private refetchVisible(): void {
        const scope = this.scope();
        if (!scope) {
            return;
        }
        const f = this.filters();
        this.instancesSvc
            .listInstances(scope, {
                outputFormat: f.outputFormat,
                status: f.status,
                search: f.search || undefined,
                sortKey: this.sortKey(),
                sortDir: this.sortDir(),
                page: 1,
                limit: this.pageSize * this.currentPage,
            })
            .pipe(
                takeUntil(this.cancel$),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: ({ items, totalItems }) => {
                    this.instances.set(items);
                    this.allLoaded.set(items.length >= totalItems);
                    this.state.setInstanceCount(totalItems);
                },
            });
    }
}
