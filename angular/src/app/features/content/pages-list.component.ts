import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    OnInit,
    signal,
    untracked,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { Store } from '@ngxs/store';
import { filter, switchMap } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import {
    ConfirmDialogService,
    ContextMenuService,
    DataGridComponent,
    DataGridData,
    ExplorerToolbarRowComponent,
    PageFooterService,
    PageTitleService,
    ToastService,
} from '@coolms/ui-angular';
import { PageService } from './page.service';
import { PageSpaceStateService } from './page-space-state.service';
import { PageTilesComponent } from './page-tiles.component';
import { PlacePageDialogComponent } from './place-page-dialog.component';
import { PageMetadataDialogComponent } from './page-metadata-dialog.component';
import { SectionPropertiesDialogComponent } from './section-properties-dialog.component';
import { PageDto } from './page.types';
import { PageEditorComponent } from './page-editor.component';
import { CreatePageDialogComponent } from './create-page-dialog.component';
import { CreateCollectionDialogComponent } from './create-collection-dialog.component';

@Component({
    selector: 'app-pages-list',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DataGridComponent, ExplorerToolbarRowComponent, PageTilesComponent],
    // ADR-153 / #1693 — this is now the `content.main` SLOT of the Pages
    // explorer, not a routed page. The shell it used to carry
    // (`<cms-list-page>`: title, toolbar, footer) comes from
    // `ExplorerLayout` + the host page instead, which is what makes room
    // for the space accordion in the left panel. The grid itself, and
    // every tree behaviour around it, is untouched.
    template: `
        <!-- Breadcrumb in BOTH modes (#1703). It used to be tile-only because
             the grid was a tree that navigated by expanding in place and had no
             "current folder" to describe. The grid is flat now — both modes list
             the SAME folder from the same cursor — so the breadcrumb is the
             navigation, not a decoration on one of them.

             navigableFrom = the space root: /, /home and /home/{uuid} are real
             ancestors of a personal pages folder, but this module has no view
             for any of them, so they render as context and are not links (the
             #1683 rule).

             editable:false — the folder is addressed by Node id (?parent=), and
             a typed path has no id to list children by. The address bar would
             have to guess; a breadcrumb that only walks the trail you actually
             came down cannot. -->
        <app-explorer-toolbar-row
            [path]="folderPath()"
            [navigableFrom]="spaceRoot()"
            [editable]="false"
            (navigate)="onBreadcrumbNavigate($event)" />

        @if (viewMode() === 'details') {
            <!-- Grid config from /api/v1/datagrids/content:pages. Rows are the
                 current folder's direct children — the same list the tiles get. -->
            <div class="pages-grid-scroll" (contextmenu)="onBackgroundContextMenu($event)">
                <coolms-datagrid
                    gridId="content:pages"
                    [configBaseUrl]="configBaseUrl()"
                    [externalData]="gridData()"
                    (rowActionTriggered)="onRowAction($event)"
                    (rowSelected)="onRowSelected($event)"
                    (rowActivated)="onRowActivated($event)"
                    (loadMore)="onLoadMore($event)">
                </coolms-datagrid>
            </div>
        } @else {
            <div class="pages-tiles-scroll" (contextmenu)="onBackgroundContextMenu($event)">
                <!-- One component for the three non-table renderings (#1709):
                     they differ in tile SIZE and how much detail each shows,
                     not in what they are, so three components would have been
                     three copies of the same selection + activation wiring. -->
                <app-page-tiles
                    [items]="folderItems()"
                    [pageTypes]="pageTypes()"
                    [selectedId]="selectedId()"
                    [layout]="viewMode()"
                    (selectionChange)="onTileSelect($event)"
                    (activate)="onTileActivate($event)" />
            </div>
        }
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .pages-tiles-scroll { flex: 1; min-height: 0; overflow: auto; }
        /* The grid must FILL the pane, not stop at its last row (#1712).
           This was display:block, so the DataGrid's own flex:1 had no flex
           context to resolve against and its height came from its content —
           a card that ended mid-pane with dead white below it. overflow is
           hidden because the grid scrolls its own card; leaving it auto would
           nest a second scrollbar around it. */
        .pages-grid-scroll {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
    `],
})
export class PagesListComponent implements OnInit {
    /**
     * The tree grid — ABSENT in tile mode, where the template does not render
     * it (#1694). Typed optional for that reason: the old `!` assertion was a
     * promise the component can no longer keep, and every call site has to
     * cope with the gap rather than trust it away.
     */
    @ViewChild(DataGridComponent) private readonly grid?: DataGridComponent;

    private readonly pageSvc    = inject(PageService);
    private readonly store      = inject(Store);
    private readonly dialog     = inject(Dialog);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly titleSvc   = inject(PageTitleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly spaceState = inject(PageSpaceStateService);
    private readonly footer     = inject(PageFooterService);

    constructor() {
        // #1693 — reload when the accordion picks a different space. The grid
        // drives its own loads through `(loadMore)`, which only fires on grid
        // events, so a space change would otherwise leave the previous
        // space's rows on screen under the new space's label.
        effect(() => {
            const key = this.spaceState.spaceKey();
            if ('' === key) {
                return;
            }
            untracked(() => {
                // The folder cursor is a path INSIDE the old space; carrying it
                // across would ask the new space for a parent it does not
                // contain, and the backend's space confinement would answer
                // with an empty list rather than an error (#1694).
                this.resetFolderCursor();
                this.reloadActiveView();
            });
        });

        // #1694 — the DataGrid and the tiles load through different calls (the
        // grid's own paged request vs the current folder's children), so
        // crossing between them has to fetch. Switching between the three tile
        // sizes does not — same rows, different CSS.
        effect(() => {
            const isDetails = 'details' === this.spaceState.viewMode();
            untracked(() => {
                if (this.lastWasDetails === isDetails) {
                    return;
                }
                const first = null === this.lastWasDetails;
                this.lastWasDetails = isDetails;
                // On mount the space effect already loads; only a real toggle
                // needs a second fetch.
                if (!first) {
                    this.reloadActiveView();
                }
            });
        });

        // #1706 — follow the folder cursor. The tree in the left panel is a
        // sibling slot: it sets the cursor and cannot call us, so the reload
        // has to be a reaction to the state rather than a call from whoever
        // moved it. Skips the very first run — the space effect above performs
        // the initial load, and reacting to the cursor's own initial value
        // would double it.
        effect(() => {
            const folder = this.spaceState.folderId();
            untracked(() => {
                if (this.lastFolderId === folder && this.folderSeen) {
                    return;
                }
                const first = !this.folderSeen;
                this.folderSeen = true;
                this.lastFolderId = folder;
                if (!first) {
                    this.onRowSelected(null);
                    this.reloadActiveView();
                }
            });
        });

        // Toolbar/header actions are rendered by the host page and performed
        // here — the two are sibling slots and cannot see each other.
        this.spaceState.actionRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(action => this.onToolbarAction(action));

        // #1717 — the folder tree is a THIRD slot, and its section actions
        // carry their own target rather than using the cursor.
        this.spaceState.sectionActionRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(({ action, path, label }) => {
                if ('section-properties' === action) {
                    this.openSectionPropertiesDialog(path, label);
                }
            });

        // Row count goes to the shared footer the explorer layout renders,
        // replacing `cms-list-page`'s own `footerCount` input.
        effect(() => this.footer.update({ count: this.footerLabel() || undefined }));
    }

    /**
     * Reload whichever view is on screen (#1694).
     *
     * List mode asks the GRID to reload rather than calling `listPages()`
     * alongside it. The grid is the only component that knows whether a sort
     * or a column filter is active, and it issues its own load either way —
     * so fetching here in parallel meant two identical requests per space
     * change, with a filtered grid then overwritten by an unfiltered fetch.
     */
    private reloadActiveView(): void {
        // Entries from the previous space/folder can only ever be stale here.
        this.childIndex.clear();
        if ('details' === this.viewMode()) {
            this.grid?.reload();

            return;
        }
        this.loadFolder();
    }

    /**
     * Reload after an edit that changed CONTENT but not STRUCTURE.
     *
     * The tree grid has a dedicated call for this so the expansion survives;
     * the tile view shows one folder at a time and has no expansion to lose,
     * so a plain reload is already structure-preserving there.
     */
    private reloadPreservingTree(): void {
        if ('details' === this.viewMode()) {
            this.grid?.reloadPreserveTree();

            return;
        }
        this.loadFolder();
    }

    /**
     * Load the folder the tile cursor points at — the space root when the
     * trail is empty, else the directory the user drilled into.
     */
    private loadFolder(): void {
        const space = this.activeSpace();
        if (null === space) {
            return;
        }
        const epoch = ++this._loadEpoch;
        const parentId = this.folderId();
        this.pageSvc.listPages({ parentId, space }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: all => {
                if (epoch !== this._loadEpoch) return;
                // Directories are NAVIGATION, and navigation lives in the left
                // panel now (#1706) — listing them here too would put the same
                // folder in two places and invite them to disagree.
                const items = all.filter(p => 'directory' !== p.nodeType);
                this.folderItems.set(items);
                // Index them so an Edit/Delete fired from a tile can resolve
                // its PageDto through the same `findPage` the grid rows use.
                for (const item of items) this.childIndex.set(item.id, item);
                this.footerLabel.set(`${items.length} page${items.length === 1 ? '' : 's'}`);
            },
            error: () => this.toast.error('Failed to load pages'),
        });
    }

    /** DataGrid config base URL from the API manifest. */
    readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );


    /**
     * The space key every list request is scoped to, or null before the
     * accordion has resolved one (#1693).
     *
     * Null means "not yet", and every load path treats it as a reason to WAIT
     * rather than to guess: an unscoped request lists the whole VFS root, so
     * the pre-space fetch would briefly show content from outside the space
     * the user is about to land in. The space effect performs the real first
     * load the moment a key arrives (#1694).
     */
    private activeSpace(): string | null {
        const key = this.spaceState.spaceKey();

        return '' === key ? null : key;
    }

    /** Which rendering is on screen — owned by the shared state, set by the toolbar. */
    protected readonly viewMode = this.spaceState.viewMode;

    /** VFS root of the active space; the breadcrumb's navigable floor. */
    protected readonly spaceRoot = this.spaceState.spaceRoot;

    /** Rows shown by the tile view: the current folder's direct children. */
    protected readonly folderItems = signal<PageDto[]>([]);

    /**
     * Configured page kinds, loaded once for the tile view's labels (#1696).
     *
     * Now lives in the SHARED state (#1711): the properties panel is a sibling
     * slot that needs the same `key → label` map, and this component is the
     * one that loads it. Empty on failure rather than blocking the listing —
     * a missing catalogue costs a label, and `typeLabel()` falls back to the
     * raw key.
     */
    protected readonly pageTypes = this.spaceState.pageTypes;

    /**
     * The folder cursor now lives in the SHARED state (#1706) — the tree in the
     * left panel sets it, this listing obeys it. It was private here while the
     * grid navigated itself.
     */
    protected readonly folderId = this.spaceState.folderId;

    /** Absolute path of the folder on screen — what the breadcrumb renders. */
    protected readonly folderPath = this.spaceState.folderPath;

    /** Selected row id, shared by both views so a toggle keeps the selection. */
    protected readonly selectedId = computed<string | null>(() => {
        const row = this.selectedRow();

        return null === row ? null : (row['id'] as string | undefined) ?? null;
    });

    /** Send the cursor back to the space root. */
    private resetFolderCursor(): void {
        this.spaceState.resetFolder();
    }

    /**
     * Whether the last rendering was the DataGrid, so the toggle effect can
     * tell a change from a mount.
     *
     * A BOOLEAN, not the mode (#1709): only the details↔tiles crossing changes
     * which call feeds the pane. `large`/`small`/`content` all read the same
     * `folderItems`, so treating them as distinct here would put a refetch
     * behind every thumbnail-size click.
     */
    private lastWasDetails: boolean | null = null;

    /** Same idea for the folder cursor: distinguish a move from the first read. */
    private lastFolderId: string | null = null;
    private folderSeen = false;

    /**
     * Footer-bar text. Set by the data handlers: a plain page count when no
     * filter is active, or a "{n} matches" label when filtering. Blank until
     * the first load so the footer stays empty on mount.
     */
    readonly footerLabel = signal<string>('');

    /**
     * Lazily-loaded tree children indexed by id, used ONLY to resolve a child's
     * PageDto when an Edit/Delete row action fires on it. Deliberately kept OUT
     * of `pages` (which feeds the grid's root `externalData`): adding children
     * there re-rendered every expanded child as a duplicate top-level row.
     */
    private readonly childIndex = new Map<string, PageDto>();

    /** Resolve a page by node id — the folder on screen, else the lookup index. */
    private findPage(id: string): PageDto | undefined {
        return this.folderItems().find(p => p.id === id) ?? this.childIndex.get(id);
    }

    /**
     * Currently selected row (null when nothing is selected).
     *
     * Shared by BOTH views: the tile view writes the same signal, so toggling
     * between them keeps the selection — and the toolbar's Edit/Delete keep
     * pointing at the same page rather than going dead on a toggle.
     */
    readonly selectedRow = signal<Record<string, unknown> | null>(null);

    /**
     * Grid rows — the SAME folder listing the tiles render (#1703).
     *
     * The grid used to hold its own root collection and walk the tree itself,
     * which meant two components each believing they knew where the user was.
     * One cursor, one list, two renderings.
     *
     * `placementSummary` is flattened here rather than server-side: the wire
     * shape is the structured `placements` the tiles and the Place dialog both
     * need, and a grid cell wants one string. Deriving it in the view keeps a
     * single representation on the API.
     */
    readonly gridData = computed((): DataGridData => {
        const items = this.folderItems().map(p => ({
            ...p,
            vfsPath:          p.vfsPath ?? '—',
            variantCount:     p.variants?.length ?? 0,
            placementSummary: (p.placements ?? []).map(x => x.surfaceKey).join(', '),
        }));

        return {
            items,
            totalItems: items.length,
            page:       1,
            limit:      50,
            totalPages: 1,
            hasMore:    false,
        };
    });

    ngOnInit(): void {
        this.titleSvc.set('Pages');

        this.pageSvc.listPageTypes().pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: types => this.pageTypes.set(types),
            error: () => this.pageTypes.set([]),
        });
    }

    /**
     * The grid asking for data — a sort, a filter, or its own reload (#1703).
     *
     * With the tree gone this is only ever "re-list what is on screen": the
     * FOLDER when no filter is active, or the bounded full-space search when
     * one is. The old expand-to-match machinery (fetch roots AND matches, hand
     * the matches to the grid, let it expand ancestor chains) went with the
     * tree — a flat grid shows the matches themselves, which is what the old
     * `!canExpand` fallback already did.
     */
    onLoadMore(event: {
        offset:        number;
        sort:          string | null;
        reset:         boolean;
        columnFilters: ReadonlyArray<string>;
    }): void {
        // Everything is fetched in one request; skip append calls.
        if (!event.reset && event.offset > 0) return;

        // #1694 — wait for a space before listing anything. The grid mounts and
        // fires its own initial load before the accordion has resolved the
        // spaces, so without this the first request goes out UNSCOPED (the
        // whole VFS root) and is then replaced a moment later by the scoped
        // one: two requests, and briefly the wrong content on screen. The
        // space effect performs the real first load.
        if (null === this.activeSpace()) return;

        const search = this.searchTermFromFilters(event.columnFilters);
        if ('' === search) {
            this.loadFolder();

            return;
        }

        // A filter searches the whole SPACE, not the current folder: a page you
        // are looking for is usually not in the folder you happen to be in, and
        // a filter that only narrowed the visible dozen rows would be a worse
        // version of reading them.
        const epoch = ++this._loadEpoch;
        this.pageSvc.listPages({ search, space: this.activeSpace() }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: matches => {
                if (epoch !== this._loadEpoch) return;
                this.folderItems.set(matches);
                this.footerLabel.set(`${matches.length} match${matches.length === 1 ? '' : 'es'}`);
            },
            error: () => this.toast.error('Failed to load pages'),
        });
    }

    /**
     * Extract a plain search term from the grid's RQL column-filter expressions.
     * Each expression looks like `slug cn "about"`; we pull the quoted value
     * (unescaping `\"`) from every filter and join them with a space so a
     * single active filter searches for exactly what was typed.
     */
    private searchTermFromFilters(filters: ReadonlyArray<string>): string {
        const terms: string[] = [];
        for (const f of filters) {
            const m = f.match(/"((?:[^"\\]|\\.)*)"/);
            if (m) terms.push(m[1].replace(/\\"/g, '"'));
        }
        return terms.join(' ').trim();
    }

    /**
     * Double-click a grid row — the same meaning the tiles give it (#1703):
     * a folder is a destination, a page is a document.
     */
    onRowActivated(row: Record<string, unknown>): void {
        const page = this.findPage(row['id'] as string);
        if (page) this.onTileActivate(page);
    }

    onRowSelected(row: Record<string, unknown> | null): void {
        this.selectedRow.set(row);
        // Publish for the two sibling slots that cannot see this component: the
        // host page's toolbar predicate (#1693) and the properties panel
        // (#1711). The DTO, not the grid row — the row is the FLATTENED shape
        // the grid was handed (`placementSummary`, `variantCount`), and the
        // panel wants the real `placements` and `variants` arrays.
        const id = row?.['id'];
        const page = 'string' === typeof id ? this.findPage(id) ?? null : null;
        this.spaceState.selectedPage.set(page);
        // Selecting does NOT open the panel (#1712) — Properties does. A panel
        // that appeared on single click landed in the middle of the
        // double-click that opens the editor, so the pane jittered under the
        // gesture. Deselecting still closes it: a panel about nothing is not a
        // panel.
        if (null === page) {
            this.spaceState.panelOpen.set(false);
        }
    }

    /** Tile click → the same selection the grid writes, so the toolbar agrees. */
    onTileSelect(page: PageDto | null): void {
        this.onRowSelected(null === page ? null : (page as unknown as Record<string, unknown>));
    }

    /**
     * Activating an item: a folder is a destination, a page is a document.
     *
     * Folders no longer appear in either listing (#1706) — the left panel owns
     * them — so in practice this opens the editor. The folder branch stays
     * because the cursor is shared and any future caller handing us a directory
     * should navigate rather than try to edit one.
     */
    onTileActivate(page: PageDto): void {
        if ('directory' !== page.nodeType) {
            this.openEditor(page);

            return;
        }
        this.spaceState.enterFolder(page.id, page.vfsPath ?? '');
    }

    /**
     * Breadcrumb click. Only paths already on the trail can be targets —
     * everything above the space root renders as static text
     * (`navigableFrom`), and the address bar is off, so a path we have no id
     * for cannot be reached. An unknown one is ignored rather than guessed.
     */
    onBreadcrumbNavigate(path: string): void {
        this.spaceState.goToPath(path);
    }

    /**
     * Right-click on empty space in the file zone (#1712).
     *
     * The zone had no menu at all, so creating a page meant reaching for the
     * header button every time — the one gesture every file manager offers
     * where you actually are.
     *
     * Bails on anything selectable so a right-click on a ROW or a TILE reaches
     * its own handler instead: the grid opens its row menu from `rowActions`
     * and the tiles have theirs, and a background menu firing afterwards would
     * replace either. Same guard shape Media and Documents use (#1710).
     */
    onBackgroundContextMenu(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (target.closest('.page-tile, coolms-datagrid tbody tr')) {
            return;
        }
        const nodes = this.spaceState.toolbarNodes();
        if (0 === nodes.length) {
            return;
        }
        event.preventDefault();
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            { _kind: 'background', _selected: false, _surface: 'context' },
            action => this.onToolbarAction(action),
        );
    }

    onRowAction(event: { action: string; row: Record<string, unknown> }): void {
        const page = this.findPage(event.row['id'] as string);
        if (!page) return;
        if (event.action === 'edit')         this.openEditor(page);
        if (event.action === 'delete')       this.confirmDelete(page);
        // `distribution` retired here (#1717): it needed a DIRECTORY row, and
        // #1706 removed those from this grid. Section settings now live on the
        // folder tree's Properties menu.
        // The row action selects as well as acts: the grid emits `rowSelected`
        // first, so the panel opens on the row under the cursor (#1712).
        if (event.action === 'properties')   this.spaceState.panelOpen.set(true);
        if (event.action === 'metadata')     this.openMetadataDialog(page);
    }

    onToolbarAction(id: string): void {
        if (id === 'create') { this.openCreateDialog(); return; }
        if (id === 'create-collection') { this.openCreateCollectionDialog(); return; }
        if (id === 'reload') { this.reloadActiveView(); return; }
        const row = this.selectedRow();
        if (!row) return;
        const page = this.findPage(row['id'] as string);
        if (!page) return;
        if (id === 'edit')       this.openEditor(page);
        if (id === 'delete')     this.confirmDelete(page);
        if (id === 'place')      this.openPlaceDialog(page);
        if (id === 'properties') this.spaceState.panelOpen.set(true);
        if (id === 'metadata')   this.openMetadataDialog(page);
    }

    /**
     * Pages list tree mode interleaves Directory rows (Container Nodes
     * like `/content`, `/content/default`) and Package rows (the actual
     * Page Containers like `/content/default/about.html`). Variant
     * editing only makes sense for Packages -- Containers have no
     * `*.dtmpl` children, so opening the editor on one renders an
     * empty "No variants yet" view (#530 / task chip).
     *
     * Kept as a single guard so any future entry point (header action,
     * keyboard shortcut, drag-drop drop target) routes through the
     * same check rather than each call site re-implementing it.
     */
    private guardPackageOrToast(page: PageDto, verb: string): boolean {
        if (page.nodeType === 'directory') {
            this.toast.info(`Cannot ${verb} a directory`, page.vfsPath ?? page.slug);
            return false;
        }
        return true;
    }

    private openCreateDialog(): void {
        this.dialog.open(CreatePageDialogComponent, {
            // #1699 — create INTO the space the explorer is showing. Without
            // it the backend derives the path from a SiteSection, so "New
            // Page" while Personal was selected silently created the page on
            // the site instead — in a space the user was not even looking at.
            data: { space: this.activeSpace(), spaceLabel: this.spaceState.spaceLabel() },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadActiveView());
    }

    /**
     * Per-locale metadata (#1715). Reloads on save because the listing renders
     * `ogImage` on its rows, so a metadata edit is visible right here.
     */
    private openMetadataDialog(page: PageDto): void {
        if (!this.guardPackageOrToast(page, 'edit metadata for')) {
            return;
        }
        this.dialog.open<boolean>(PageMetadataDialogComponent, {
            data: { page },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadPreservingTree());
    }

    /**
     * Section properties (#1717) — feed, post defaults, distribution channels.
     *
     * This is the surface that gives the M6.a distribution config a door again:
     * it was a row action on a directory row, and #1706 took directory rows out
     * of the grid, so it had become unreachable.
     */
    private openSectionPropertiesDialog(path: string, label: string): void {
        this.dialog.open<boolean | null>(SectionPropertiesDialogComponent, {
            data: { path, label },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadActiveView());
    }

    private openCreateCollectionDialog(): void {
        this.dialog.open(CreateCollectionDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.reloadActiveView());
    }

    /**
     * Where this page appears (#1698) — distribution, not publishing.
     *
     * Guarded to Packages for the same reason editing is: a directory has no
     * Package to link into a surface, and offering the dialog on one would
     * open a form with nothing it could do.
     */
    private openPlaceDialog(page: PageDto): void {
        if (!this.guardPackageOrToast(page, 'place')) return;

        this.dialog.open<boolean>(PlacePageDialogComponent, {
            data: { page },
            backdropClass: 'cdk-overlay-dark-backdrop',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            // Only when something actually changed: placement is derived from
            // links, so the row's badges are stale the moment one is added.
            .subscribe(() => this.reloadPreservingTree());
    }

    private openEditor(page: PageDto): void {
        if (!this.guardPackageOrToast(page, 'edit')) return;
        this.dialog.open(PageEditorComponent, {
            data:       { page },
            panelClass: 'cms-editor-dialog',
        }).closed
            .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
            // Editing a page only changes variant content / metadata, never the
            // tree structure -- so refresh in place WITHOUT collapsing the tree
            // (a plain reload() resets the expand state). create / delete / move
            // still use reload() since those DO change the structure.
            .subscribe(() => this.reloadPreservingTree());
    }

    private confirmDelete(page: PageDto): void {
        if (!this.guardPackageOrToast(page, 'delete')) return;
        this.confirmSvc.confirmDelete(page.slug).pipe(
            filter(Boolean),
            switchMap(() => this.pageSvc.deletePage(page.id)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next:  () => {
                this.toast.success('Deleted', page.slug);
                // The deleted row was the selection; leaving it set would keep
                // the toolbar's Edit/Delete live over a page that is gone.
                this.onRowSelected(null);
                this.reloadActiveView();
            },
            error: () => this.toast.error('Delete failed'),
        });
    }

    /** Monotonically-increasing load counter; stale reset responses are discarded. */
    private _loadEpoch = 0;
}
