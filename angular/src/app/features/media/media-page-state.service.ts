import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Subject } from 'rxjs';
import { MediaAssetDto, CollectionNode, MediaViewMode } from './media.types';
import { toExplorerViewMode } from '@coolms/ui-angular';
import { NaviGraphNode, UserPreferencesService } from '@coolms/core-angular';
/**
 * Scoped shared state for the Media Library page.
 *
 * Provided in MediaLibraryPage's `providers` array so every slot component
 * loaded under the page's DI tree (CollectionsTree, MediaGrid, MediaDetail,
 * MediaStatusBar) can inject it without any prop-drilling.
 *
 * Slots read reactive state from signals.
 * Slots dispatch actions via subjects — the page subscribes and calls APIs.
 *
 * Session state (currentDir, viewMode) is automatically restored from
 * UserPreferencesService on construction and saved on every change.
 */
@Injectable()
export class MediaPageStateService {

    private readonly prefs = inject(UserPreferencesService);

    // -- Navigation & selection ------------------------------------------------

    readonly currentDir  = signal('/media');

    /**
     * Root of the ACTIVE space — the floor the path bar will not go above
     *. Media was the only explorer passing no `navigableFrom`, so its
     * typed-path input could leave the space entirely while the accordion
     * beside it still claimed Shared. Not persisted: it is derived from
     * whichever space is selected, and `SpaceSelectionStore` resolves that on
     * load from the restored `currentDir`.
     */
    readonly spaceRoot   = signal('/media');
    readonly selectedIds = signal<string[]>([]);
    readonly activeAsset = signal<MediaAssetDto | null>(null);
    /** The collection (directory) whose Properties panel is open, or null.
     *  Mutually exclusive with activeAsset — the same right panel hosts both. */
    readonly activeCollection = signal<{ path: string; name: string } | null>(null);
    readonly viewMode    = signal<MediaViewMode>('medium');

    // -- API-loaded state (populated by MediaLibraryPage) ---------------------

    readonly assets       = signal<MediaAssetDto[]>([]);
    readonly totalItems   = signal(0);
    readonly loading      = signal(false);
    readonly collections  = signal<CollectionNode[]>([]);
    readonly toolbarNodes = signal<NaviGraphNode[]>([]);

    readonly hasMore = computed(() => this.assets().length < this.totalItems());

    /**
     * NaviGraph node whose meta drives the right-panel header. Mirrors
     * Document's `panelNode` — the panel chrome is then identical
     * across modules even though body content differs.
     */
    readonly panelNode = computed<NaviGraphNode | null>(() => {
        const action = this.activeAsset() !== null ? 'properties'
            : this.activeCollection() !== null ? 'col-properties'
            : null;
        if (action === null) return null;
        return this.toolbarNodes().find((n) => n.meta?.['action'] === action) ?? null;
    });

    // -- Actions (page subscribes and makes API / dialog calls) ----------------

    /** Toolbar or grid drop-zone triggers a file-input click. */
    readonly uploadRequested$            = new Subject<void>();

    /** Files dropped on the grid drop-zone. */
    readonly filesDropped$               = new Subject<File[]>();

    /** Toolbar "New Collection" / "New Sub-collection". */
    readonly newCollectionRequested$     = new Subject<void>();

    /** Toolbar "Rename" — passes the path to rename. */
    readonly renameCollectionRequested$  = new Subject<string>();

    /** Delete-collection from toolbar (passes collection path). */
    readonly deleteCollectionByPath$     = new Subject<string>();

    /** Asset permissions dialog request. */
    readonly permissionsRequested$       = new Subject<MediaAssetDto>();

    /** Collection permissions dialog request. */
    readonly collectionPermsRequested$   = new Subject<string>();

    /** Move-to-collection dialog request. */
    readonly moveRequested$              = new Subject<MediaAssetDto>();

    /** Asset(s) delete request. */
    readonly assetDeleteRequested$       = new Subject<MediaAssetDto[]>();

    /** Media decoupling: Properties toggle from toolbar / context menu. */
    readonly propertiesToggleRequested$  = new Subject<MediaAssetDto>();

    /** Image-editor open request from grid context-menu (Phase 1C). */
    readonly editImageRequested$         = new Subject<MediaAssetDto>();

    /** Asset saved — page updates assets[] and activeAsset. */
    readonly assetSaved$                 = new Subject<MediaAssetDto>();

    /** Grid scroll sentinel intersects — page loads next page. */
    readonly loadNextPageRequested$      = new Subject<void>();

    constructor() {
        // Restore last session state
        const saved = this.prefs.getPageState<{ lastDir?: string; viewMode?: string }>('media');
        if (saved?.lastDir)  this.currentDir.set(saved.lastDir);

        // — a preference written before the shared vocabulary can say
        // `list`, which is now the name of nothing. It meant the wide row, so
        // it becomes `content`; anything else unrecognised falls back to the
        // default rather than restoring a mode the grid cannot draw.
        const restored = 'list' === saved?.viewMode
            ? 'content'
            : toExplorerViewMode(saved?.viewMode);
        if (null !== restored) {
            this.viewMode.set(restored);
        }

        // Persist currentDir changes
        effect(() => {
            const dir = this.currentDir();
            untracked(() => this.prefs.setPageState('media', { lastDir: dir }));
        });

        // Persist viewMode changes
        effect(() => {
            const mode = this.viewMode();
            untracked(() => this.prefs.setPageState('media', { viewMode: mode }));
        });
    }
}
