import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    HostListener,
    inject,
    OnInit,
    signal,
    untracked,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { HttpClient } from '@angular/common/http';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom, Observable } from 'rxjs';
import {
    CoolmsImageEditorHostComponent,
    type CoolmsImageEditorHostData,
    type CoolmsImageEditorHostResult,
} from '@coolms/image-editor-angular';
import { Store } from '@ngxs/store';
import { AppConfigState, NaviGraphService, resolvePattern, UserPreferencesService } from '@coolms/core-angular';
import {
    catchError,
    debounceTime,
    distinctUntilChanged,
    EMPTY,
    filter,
    forkJoin,
    map,
    of,
    Subject,
    switchMap,
} from 'rxjs';
import { MediaService } from './media.service';
import { MediaAssetDto, MediaViewMode } from './media.types';
import { MediaPermissionsComponent } from './media-permissions.component';
import { CollectionPermissionsComponent } from './collection-permissions.component';
import { MoveToDialogComponent } from './move-to-dialog.component';
import { ApiService } from '../../api/api.service';
import {
    CmsPageHeaderComponent,
    ConfirmDialogService,
    DeleteNodeDialogComponent,
    DeleteNodeDialogResult,
    ExplorerLayoutComponent,
    ExplorerViewSwitcherComponent,
    PageFooterService,
    PageToolbarComponent,
    ToastService,
    ToolbarAction,
} from '@coolms/ui-angular';
import { MediaPageStateService } from './media-page-state.service';
import { VfsLiveEventsService } from '../vfs/vfs-live-events.service';

export type ToolbarContext =
    | { type: 'none' }
    | { type: 'collection'; path: string; name: string }
    | { type: 'files'; assets: MediaAssetDto[] };

/**
 * Media Library page — thin orchestrator.
 *
 * Provides MediaPageStateService (scoped to this page subtree) and
 * subscribes to its action Subjects to perform API calls / open dialogs.
 *
 * All UI (collections tree, grid, detail panel, status bar) is rendered by
 * slot components loaded dynamically via ExplorerLayoutComponent.
 *
 * Only the page toolbar (breadcrumb + search + mime filter) is rendered
 * directly here and projected into ExplorerLayoutComponent via ng-content.
 */
@Component({
    selector: 'app-media-library',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [MediaPageStateService, PageFooterService],
    imports: [
    PageToolbarComponent,
    CmsPageHeaderComponent,
    ExplorerLayoutComponent,
    ExplorerViewSwitcherComponent
],
    template: `
        <div class="media-library-page">

            <app-explorer-layout
                #layout
                layoutId="media:library"
                [context]="pageContext()"
                (backgroundClick)="state.selectedIds.set([])">

                <!-- Page header: fixed title + global primary actions -->
                <cms-page-header
                    explorer-header
                    title="Media Library"
                    icon="images"
                    [actions]="headerActions()"
                    (actionClick)="onToolbarAction($event)" />

                <!-- Toolbar projected into ExplorerLayoutComponent's ng-content.
                     The breadcrumb has moved to a dedicated row at the top of
                     the grid (rendered by MediaGridSlotComponent). -->
                <!-- alwaysShow: this bar hosts the search, the type filter and
                     the view switcher, none of which are "actions". Without it
                     the whole row vanishes whenever nothing is selected. -->
                <app-page-toolbar
                    [alwaysShow]="true"
                    [treeSlug]="toolbarTree"
                    [context]="actionContext()"
                    (headerActionsChanged)="headerActions.set($event)"
                    (actionClick)="onToolbarAction($event)">

                    <div toolbar-filters class="d-flex gap-2">
                        <input type="text"
                               class="cms-input"
                               placeholder="Search…"
                               style="width: 200px"
                               (input)="onSearchChange($any($event.target).value)" />

                        <select class="cms-select"
                                style="width: 130px"
                                (change)="onMimeFilterChange($any($event.target).value)">
                            <option value="">All types</option>
                            <option value="image/">Images</option>
                            <option value="video/">Videos</option>
                            <option value="audio/">Audio</option>
                        </select>
                    </div>

                    <!-- #1709 — the same switcher Pages uses, fed by the modes
                         media:library declares. Media used to seed four view-*
                         NaviGraph nodes with its own icons and its own word for
                         the wide row ("list", which meant the TABLE in Pages).
                         One component, one vocabulary. -->
                    <app-explorer-view-switcher
                        toolbar-right-extra
                        [modes]="layout.viewModes()"
                        [active]="state.viewMode()"
                        (modeChange)="state.viewMode.set($event)" />

                </app-page-toolbar>

                <!-- Hidden file input — triggered by uploadRequested$ / toolbar Upload -->
                <input #fileInput type="file" hidden multiple
                       (change)="onFileInputChange($event)" />

            </app-explorer-layout>

        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .media-library-page { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    `],
})
export class MediaLibraryPage implements OnInit {
    // ── Injected services ───────────────────────────────────────────────────

    readonly state = inject(MediaPageStateService);
    private readonly footer     = inject(PageFooterService);

    private readonly svc        = inject(MediaService);
    private readonly api        = inject(ApiService);
    private readonly dialog     = inject(Dialog);
    private readonly prefs      = inject(UserPreferencesService);
    private readonly naviGraph  = inject(NaviGraphService);
    private readonly store      = inject(Store);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly toast      = inject(ToastService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly http       = inject(HttpClient);
    private readonly liveEvents = inject(VfsLiveEventsService);

    @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

    // ── Page-local pagination state ─────────────────────────────────────────

    private readonly search     = signal('');
    private readonly mimeFilter = signal('');
    private readonly page       = signal(1);
    private readonly limit      = signal(24);
    private loadId              = 0;
    private readonly searchSubject = new Subject<string>();

    // ── Computed context passed to ExplorerLayout ───────────────────────────

    readonly pageContext = computed((): Record<string, unknown> => ({
        // The right panel hosts either an asset OR a collection — show it for both.
        activeItem: this.state.activeAsset() ?? this.state.activeCollection(),
    }));

    // ── Computed toolbar state ──────────────────────────────────────────────

    readonly selectedAssets = computed(() =>
        this.state.assets().filter(a => this.state.selectedIds().includes(a.id))
    );

    readonly toolbarContext = computed((): ToolbarContext => {
        const files = this.selectedAssets();
        if (files.length > 0) return { type: 'files', assets: files };
        const dir = this.state.currentDir();
        if (dir !== '/media') return { type: 'collection', path: dir, name: dir.split('/').at(-1) ?? dir };
        return { type: 'none' };
    });

    /**
     * The bar and the header both render `navi.toolbar.media`; this page only
     * says what state it is in.
     *
     * Three computeds used to live here: one picking header actions out of the
     * tree by a hardcoded id set, one mapping the rest into the bar (with its
     * own divider trimming), one for the right-hand group. The tree says
     * `position: header` now, and the shared toolbar does the rest -- the same
     * conversion the VFS explorer got, which is where the second copy of this
     * mapper lived.
     */
    readonly toolbarTree = 'navi.toolbar.media';
    readonly headerActions = signal<ToolbarAction[]>([]);

    /**
     * What the tree's conditions are evaluated against.
     *
     * `mimeType` is set when exactly one asset is selected so showWhen rules can
     * filter by it (Edit Image only appears for `image/*`). Multi-select and
     * non-asset contexts do not expose it.
     *
     * `status` exposes the focused asset's processing status (asset actions
     * carry `status eq 'ready'` -- operating on pending / failed assets risks
     * acting on pre-process bytes). A multi-selection reports `ready` only if
     * every asset is, otherwise `mixed` so the strict predicate hides them.
     * Non-asset contexts do not expose it at all, and ADR-093 treats an absent
     * field as false, which is the outcome we want.
     */
    readonly actionContext = computed((): Record<string, unknown> => {
        const ctx      = this.toolbarContext();
        const selected = this.selectedAssets();

        const _context = ctx.type === 'none'
            ? 'background'
            : ctx.type === 'collection' ? 'collection' : 'asset';

        const focusedMime = (_context === 'asset' && selected.length === 1) ? selected[0]?.mimeType : undefined;

        let focusedStatus: string | undefined;
        if (_context === 'asset') {
            if (selected.length === 1) {
                focusedStatus = selected[0]?.status;
            } else if (selected.length > 1) {
                focusedStatus = selected.every(a => a.status === 'ready') ? 'ready' : 'mixed';
            }
        }

        return {
            _context,
            _single:  selected.length <= 1,
            _surface: 'toolbar',
            _propertiesPanelOpen: this.state.activeAsset() !== null,
            _collectionPanelOpen: this.state.activeCollection() !== null,
            mimeType: focusedMime,
            status:   focusedStatus,
        };
    });

    // ── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        // Keep footer status bar in sync with media state
        effect(() => {
            const loading  = this.state.loading();
            const total    = this.state.totalItems();
            const selected = this.state.selectedIds().length;

            this.footer.set({
                loading,
                count:    !loading && total > 0
                            ? `All ${total} file${total === 1 ? '' : 's'} loaded`
                            : undefined,
                selected: selected > 0 ? `${selected} selected` : undefined,
            });
        });

        // Debounce search input
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(value => this.search.set(value));

        // Reload assets when search / mime / dir changes
        effect(() => {
            this.search();
            this.mimeFilter();
            this.state.currentDir();
            untracked(() => this.resetAndLoad());
        });

        // Live updates: when another session creates / deletes / renames /
        // moves an asset in the collection we're viewing, the backend
        // publishes to `vfs.parent.{collectionNodeId}` (every VFS mutation
        // emits since #722). Refetch the grid (debounced to collapse bursts
        // like a multi-file upload). Mirrors the VFS File Explorer's
        // `VfsLiveEventsService` wiring, resolving the collection path to its
        // Node id via the same `/vfs/files` stat the explorer uses; switchMap
        // tears down the previous channel subscription on navigation.
        toObservable(this.state.currentDir).pipe(
            switchMap(dir => this.statFolderId(dir)),
            switchMap(folderId => folderId === null ? EMPTY : this.liveEvents.watch(folderId)),
            debounceTime(300),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.resetAndLoad());

        // Keep the right detail panel in sync with selection:
        //   - panel showing an asset that's no longer selected:
        //     either follow to the new focused asset (single-select
        //     replacement) or close the panel (selection cleared,
        //     asset deleted, or multi-select).
        //   - panel showing an asset that's still selected: leave it
        //     open; the user opened it explicitly via Properties.
        effect(() => {
            const selected = this.selectedAssets();
            const active   = this.state.activeAsset();
            if (!active) return;
            if (selected.some((a) => a.id === active.id)) return;
            // Active asset left the selection. If exactly one other
            // asset is now selected, follow it; otherwise close.
            const next = selected.length === 1 ? selected[0] : null;
            untracked(() => this.state.activeAsset.set(next));
        });
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    ngOnInit(): void {
        // Load toolbar navgraph
        const naviManifest = this.store.selectSnapshot(AppConfigState.manifest)?.navi;
        if (naviManifest?.nodesByTree) {
            const url = resolvePattern(naviManifest.nodesByTree, { slug: 'navi.toolbar.media' });
            this.naviGraph.loadTree(url).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(nodes => this.state.toolbarNodes.set(nodes));
        }

        // Subscribe to action subjects from slot components

        this.state.uploadRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.fileInputRef?.nativeElement.click());

        this.state.filesDropped$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(files => this.uploadFiles(files));

        this.state.permissionsRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(asset => this.openPermissions(asset));

        this.state.collectionPermsRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(path => this.openCollectionPermissions(path));

        this.state.moveRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(asset => this.openMoveDialog(asset));

        this.state.assetDeleteRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(assets => this.deleteAssets(assets));

        this.state.editImageRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(asset => { void this.openImageEditor(asset); });

        this.state.propertiesToggleRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(asset => this.togglePropertiesPanel(asset));

        this.state.assetSaved$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(updated => {
                this.state.assets.update(list => list.map(a => a.id === updated.id ? updated : a));
            });

        this.state.loadNextPageRequested$.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.page.update(p => p + 1);
                this.loadNextPage();
            });

        // Initial collections load
        this.loadCollections();
    }

    // ── Toolbar action handler ──────────────────────────────────────────────

    onToolbarAction(action: string): void {
        switch (action) {
            case 'upload':
                this.fileInputRef?.nativeElement.click();
                break;

            case 'new-collection':
            case 'new-sub':
                this.state.newCollectionRequested$.next();
                break;

            case 'col-perms':
                this.openCollectionPermissions(this.state.currentDir());
                break;

            case 'col-properties': {
                const path = this.state.currentDir();
                this.toggleCollectionProperties(path, path.split('/').at(-1) ?? path);
                break;
            }

            case 'rename':
                this.state.renameCollectionRequested$.next(this.state.currentDir());
                break;

            case 'delete-col': {
                const colPath = this.state.currentDir();
                const colName = colPath.split('/').at(-1) ?? '';
                const ref = this.dialog.open<DeleteNodeDialogResult | null>(DeleteNodeDialogComponent, {
                    data: {
                        name:           colName,
                        message:        'This collection will be permanently deleted.',
                        showRecursive:  true,
                        recursiveLabel: 'Delete all files inside this collection',
                    },
                });
                ref.closed.pipe(
                    filter((result): result is DeleteNodeDialogResult => result !== null && result !== undefined),
                    switchMap(result => this.svc.deleteCollection(colPath, result.recursive).pipe(catchError(() => of(null)))),
                    takeUntilDestroyed(this.destroyRef),
                ).subscribe(() => {
                    this.state.currentDir.set('/media');
                    this.loadCollections();
                });
                break;
            }

            // Right-panel decoupling: `case 'edit':` retired alongside
            // the `/edit` NaviGraph node. The Properties action now
            // owns the Details-panel open path.

            case 'edit-image': {
                const target = this.selectedAssets()[0];
                if (target) void this.openImageEditor(target);
                break;
            }

            case 'perms':
                if (this.selectedAssets()[0]) this.openPermissions(this.selectedAssets()[0]);
                break;

            case 'move':
                if (this.selectedAssets().length > 0) this.openMoveDialog(this.selectedAssets()[0]);
                break;

            case 'download':
                window.open(this.selectedAssets()[0]?.originalUrl ?? '', '_blank');
                break;

            case 'delete':
                this.deleteAssets(this.selectedAssets());
                break;

            case 'properties': {
                // Media decoupling: Properties toggles the Details
                // panel for the single selected asset. Multi-select
                // is gated out by the NaviGraph showWhen predicate
                // (`_single eq true`), so this handler assumes one
                // asset is in scope.
                const sel = this.selectedAssets();
                if (sel.length !== 1) return;
                this.togglePropertiesPanel(sel[0]);
                break;
            }
        }
    }

    /**
     * Toggle the Details panel for the given asset. Open if closed
     * (or showing a different asset); close if it's already the
     * active asset. Shared by the toolbar Properties action and the
     * context-menu Properties action.
     */
    private togglePropertiesPanel(asset: MediaAssetDto): void {
        if (this.state.activeAsset()?.id === asset.id) {
            this.state.activeAsset.set(null);
        } else {
            this.state.activeCollection.set(null); // mutually exclusive with the collection panel
            this.state.activeAsset.set(asset);
        }
    }

    /**
     * Open / close the collection Properties panel (localized title + description)
     * for the given directory path. Mutually exclusive with the asset panel.
     */
    private toggleCollectionProperties(path: string, name: string): void {
        if (this.state.activeCollection()?.path === path) {
            this.state.activeCollection.set(null);
        } else {
            this.state.activeAsset.set(null);
            this.state.activeCollection.set({ path, name });
        }
    }

    // ── File upload ─────────────────────────────────────────────────────────

    onFileInputChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        this.uploadFiles(files);
    }

    private uploadFiles(files: File[]): void {
        for (const file of files) {
            this.svc.upload(file, this.state.currentDir()).pipe(
                takeUntilDestroyed(this.destroyRef),
            ).subscribe(progress => {
                if (progress.status === 'done')  this.resetAndLoad();
                if (progress.status === 'error') this.toast.error(progress.error ?? 'Upload failed', file.name);
            });
        }
    }

    // ── Dialogs ─────────────────────────────────────────────────────────────

    /**
     * Phase 1C: opens the headless image editor on the focused asset.
     * Same flow as the existing Edit Image button in the detail panel,
     * fired from the toolbar / context-menu surfaces via the
     * `'edit-image'` NaviGraph action.
     *
     * Defence in depth: NaviGraph showWhen already gates the
     * `edit-image` action to `status eq 'ready'`, and the grid
     * dblclick path filters too. This guard handles flows that
     * bypass both surfaces (deep links, race where status flips
     * during the click sequence). Toasts and returns instead of
     * throwing so the click feels like a no-op to the user.
     */
    private async openImageEditor(asset: MediaAssetDto): Promise<void> {
        if (asset.status !== 'ready') {
            this.toast.info(
                asset.status === 'failed'
                    ? 'Image failed to process and cannot be edited.'
                    : 'Image is still processing. Please wait a moment and try again.',
                asset.originalFilename,
            );
            return;
        }
        const data: CoolmsImageEditorHostData = {
            context: 'media',
            asset: {
                uuid:        asset.id,
                originalUrl: asset.originalUrl ?? '',
                filename:    asset.originalFilename,
                mimeType:    asset.mimeType,
                path:        asset.path ?? null,
                dimensions:  asset.dimensions
                    ? { width: asset.dimensions.width, height: asset.dimensions.height }
                    : null,
            },
        };
        const dialogRef = this.dialog.open<CoolmsImageEditorHostResult, CoolmsImageEditorHostData>(
            CoolmsImageEditorHostComponent,
            { data, backdropClass: 'cdk-overlay-dark-backdrop', disableClose: true },
        );
        const result = await firstValueFrom(dialogRef.closed);
        if (!result || result.kind === 'cancelled') return;

        // Refresh the asset list so the new bytes / variants surface
        // once thumbnail regeneration completes server-side.
        this.resetAndLoad();
    }

    private openPermissions(asset: MediaAssetDto): void {
        this.dialog.open(MediaPermissionsComponent, {
            data: { asset, icon: this.getActionIcon('perms') },
        });
    }

    private openCollectionPermissions(path: string): void {
        this.dialog.open(CollectionPermissionsComponent, {
            data: { path, icon: this.getActionIcon('col-perms') },
        });
    }

    private openMoveDialog(asset: MediaAssetDto): void {
        this.dialog.open(MoveToDialogComponent, {
            data: {
                asset,
                currentDir: this.state.currentDir(),
                icon: this.getActionIcon('move', 'folder-symlink-fill'),
            },
        }).closed.pipe(
            filter(Boolean),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => this.resetAndLoad());
    }

    // ── Asset deletion ──────────────────────────────────────────────────────

    private deleteAssets(assets: MediaAssetDto[]): void {
        if (!assets.length) return;
        const label = assets.length === 1 ? assets[0].originalFilename : `${assets.length} files`;
        this.confirmSvc.confirmDelete(label).pipe(
            filter(Boolean),
            switchMap(() => forkJoin(
                assets.map(a => this.svc.delete(a.id).pipe(catchError(() => of(null))))
            )),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.state.selectedIds.set([]);
            if (this.state.activeAsset() && assets.some(a => a.id === this.state.activeAsset()!.id)) {
                this.state.activeAsset.set(null);
            }
            this.resetAndLoad();
        });
    }

    // ── Collections ─────────────────────────────────────────────────────────

    private loadCollections(): void {
        // Load collections relative to the currently active space root.
        // currentDir always points at a path under the active space's
        // root, so deriving the root segment from it scopes the
        // listing to the right subtree (Personal / Shared / per-site).
        const root = this.deriveSpaceRoot(this.state.currentDir());
        this.svc.listCollections(root, 5).pipe(
            catchError(() => of([])),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(flat => {
            this.state.collections.set(this.buildTree(flat));
        });
    }

    /**
     * Best-effort derivation of the active space root from a
     * `currentDir` path. The wrapper {@link MediaSpaceAccordionComponent}
     * also owns this rebinding once it loads spaces from the API;
     * this fallback covers the brief window before the accordion's
     * spaces[] signal is populated.
     */
    private deriveSpaceRoot(currentDir: string): string {
        if (currentDir.startsWith('/home/')) {
            // /home/{uuid}/media/...
            const parts = currentDir.split('/').filter(Boolean);
            return parts.length >= 3 ? '/' + parts.slice(0, 3).join('/') : '/media';
        }
        if (currentDir.startsWith('/content/')) {
            // /content/{slug}/media/...
            const parts = currentDir.split('/').filter(Boolean);
            return parts.length >= 3 ? '/' + parts.slice(0, 3).join('/') : '/media';
        }
        return '/media';
    }

    private buildTree(flat: { path: string; name: string; depth: number }[]): import('./media.types').CollectionNode[] {
        const root:   import('./media.types').CollectionNode[] = [];
        const byPath  = new Map<string, import('./media.types').CollectionNode>();
        for (const item of flat) {
            const node: import('./media.types').CollectionNode = { ...item, children: [] };
            byPath.set(item.path, node);
            const parentPath = item.path.split('/').slice(0, -1).join('/');
            const parent     = byPath.get(parentPath);
            if (parent) parent.children.push(node);
            else root.push(node);
        }
        return root;
    }

    /**
     * Resolve a collection path to its VFS Node id — the
     * `vfs.parent.{id}` channel selector for live updates. Mirrors the
     * VFS File Explorer's folder stat (`GET /vfs/files?path=`). Returns
     * null on any error (missing path, permission denied, transport) so
     * the realtime layer degrades to silence; the REST grid fetch stays
     * authoritative.
     */
    private statFolderId(path: string): Observable<string | null> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';
        if (!baseUrl || '' === path) {
            return of<string | null>(null);
        }
        const url = `${baseUrl}/vfs/files?path=${encodeURIComponent(path)}`;

        return this.http.get<{ id?: string }>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            map(node => (typeof node?.id === 'string' ? node.id : null)),
            catchError(() => of<string | null>(null)),
        );
    }

    // ── Pagination ──────────────────────────────────────────────────────────

    private resetAndLoad(): void {
        this.loadId++;
        this.page.set(1);
        this.state.assets.set([]);
        this.state.totalItems.set(0);
        this.state.loading.set(false);
        this.loadNextPage();
    }

    private loadNextPage(): void {
        if (this.state.loading()) return;
        if (this.page() > 1 && !this.state.hasMore()) return;

        this.state.loading.set(true);
        const myLoadId = this.loadId;
        const isReset  = this.page() === 1;

        this.svc.list({
            search:   this.search(),
            mimeType: this.mimeFilter(),
            page:     this.page(),
            limit:    this.limit(),
            dir:      this.state.currentDir(),
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: r => {
                if (myLoadId !== this.loadId) return;
                const merged = isReset ? r.member : [...this.state.assets(), ...r.member];
                this.state.assets.set(merged);
                // Clamp totalItems when a non-initial page returns zero
                // items: without it, `hasMore` stays `true` forever, the
                // scroll-sentinel re-triggers `loadNextPageRequested$` on
                // every CD cycle, and the page hammers `/api/v1/media` with
                // empty-page requests until the tab is closed (the 1198-
                // request storm reported on Media Library page loads).
                // Past-the-end pages don't change the assets length, so
                // pinning totalItems to that length flips `hasMore` off.
                const isPastEnd = !isReset && r.member.length === 0;
                this.state.totalItems.set(isPastEnd ? merged.length : r.totalItems);
                this.state.loading.set(false);
            },
            error: () => {
                if (myLoadId === this.loadId) this.state.loading.set(false);
            },
        });
    }

    // ── Keyboard shortcuts ──────────────────────────────────────────────────

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (event.key === 'Delete' && this.state.selectedIds().length > 0) {
            event.preventDefault();
            this.deleteAssets(this.selectedAssets());
        }
        if (event.key === 'Escape') {
            this.state.selectedIds.set([]);
            this.state.activeAsset.set(null);
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
            event.preventDefault();
            this.state.selectedIds.set(this.state.assets().map(a => a.id));
        }
    }

    // ── Input handlers ──────────────────────────────────────────────────────

    onSearchChange(value: string): void     { this.searchSubject.next(value); }
    onMimeFilterChange(value: string): void { this.mimeFilter.set(value); }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private getActionIcon(actionId: string, fallback = 'lock'): string {
        const node = this.state.toolbarNodes().find(n => n.meta['action'] === actionId);
        return node ? String(node.meta['icon'] ?? fallback) : fallback;
    }


}
