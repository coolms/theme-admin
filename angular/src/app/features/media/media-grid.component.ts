import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';

import { CmsItemInteractionsDirective, ContextMenuService, DataGridComponent, DataGridData, ToastService, type CmsSelectionChange } from '@coolms/ui-angular';
import { Store } from '@ngxs/store';
import { AppConfigState, CmsLoaderComponent, NaviGraphNode } from '@coolms/core-angular';
import { MediaService } from './media.service';
import { MediaAssetDto, MediaViewMode } from './media.types';

@Component({
    selector: 'app-media-grid',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, CmsItemInteractionsDirective, DataGridComponent],
    template: `
        @if (viewMode() === 'details') {
            <!-- — the platform DataGrid, config at
                 /api/v1/datagrids/media:assets. Media never had a table: its
                 modes were three thumbnail sizes plus a wide row, so "which of
                 these is 3 MB, and who uploaded it" had no answer short of
                 clicking every tile. -->
            <coolms-datagrid
                gridId="media:assets"
                [configBaseUrl]="configBaseUrl()"
                [externalData]="gridData()"
                (rowSelected)="onGridRowSelected($event)"
                (rowActivated)="onGridRowActivated($event)"
                (rowContextMenu)="onGridRowContextMenu($event)">
            </coolms-datagrid>
        } @else {
        <div class="media-grid" [style.grid-template-columns]="gridCols()">

            @for (asset of assets(); track asset.id) {
                <div class="media-tile"
                     data-selectable
                     cmsItemInteractions
                     [cmsItem]="asset"
                     [selectionMode]="'toggle'"
                     [currentSelection]="currentSelectionArray()"
                     [class.selected]="isSelected(asset.id)"
                     [class.list-mode]="viewMode() === 'content'"
                     (selectionChanged)="onSelectionChanged($event)"
                     (activated)="onActivate($event)"
                     (contextMenuRequested)="onContextMenu($event)">

                    <div class="media-tile-thumb"
                         [style.height]="viewMode() === 'content' ? '40px' : thumbHeight()"
                         [style.width]="viewMode() === 'content' ? '40px' : '100%'"
                         [style.flex-shrink]="viewMode() === 'content' ? '0' : null">
                        @if (svc.mimeCategory(asset.mimeType) === 'image' && asset.thumbnailUrl) {
                            <img [src]="asset.thumbnailUrl" [alt]="assetAlt(asset)" loading="lazy"
                                 (error)="onImgError($event)" />
                        } @else {
                            <div class="media-tile-icon">
                                <i class="bi {{ svc.mimeIcon(asset.mimeType) }}"></i>
                            </div>
                        }

                        @if (asset.status === 'pending') {
                            <div class="media-tile-overlay">
                                <cms-loader [inline]="true" />
                            </div>
                        }
                        @if (asset.status === 'failed') {
                            <div class="media-tile-overlay bg-danger bg-opacity-75">
                                <span class="text-white small">
                                    <i class="bi bi-exclamation-triangle-fill"></i> Failed
                                </span>
                            </div>
                        }
                    </div>

                    @if (viewMode() !== 'small') {
                        <div class="media-tile-info"
                             [style.flex]="viewMode() === 'content' ? '1' : null">
                            <div class="small fw-semibold text-truncate" [title]="asset.originalFilename">
                                {{ asset.originalFilename }}
                            </div>
                            @if (viewMode() === 'content') {
                                <span class="text-muted" style="font-size:.75rem">
                                    {{ asset.mimeType }} · {{ formatSize(asset.fileSize) }}
                                </span>
                            } @else {
                                <div class="text-muted" style="font-size:.7rem">{{ formatSize(asset.fileSize) }}</div>
                            }
                        </div>
                    }
                </div>
            }
        </div>
        }
    `,
    styles: [`
        /* Both branches stretch into the height the slot now gives us
           (#1760); the tiles keep their own rows at content height so a
           half-empty folder does not grow giant tiles. */
        :host > coolms-datagrid { flex: 1; min-height: 0; }
        .media-grid {
            flex: 1;
            display: grid;
            gap: 12px;
            padding: 12px;
            grid-auto-rows: min-content;
        }
        .media-tile {
            border: 2px solid transparent;
            border-radius: var(--cms-radius-md, 8px);
            overflow: hidden;
            cursor: pointer;
            background: var(--cms-surface);
            transition: border-color .15s;
            display: flex;
        }
        .media-tile:not(.list-mode) { flex-direction: column; }
        .media-tile.list-mode { flex-direction: row; align-items: center; gap: 8px; padding: 4px 8px; }
        .media-tile:hover { border-color: var(--cms-btn-hover-border); }
        .media-tile.selected { border-color: var(--cms-accent); }
        .media-tile-thumb {
            position: relative;
            overflow: hidden;
            background: var(--cms-surface-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .media-tile:not(.list-mode) .media-tile-thumb { width: 100%; }
        .media-tile-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .media-tile-icon { font-size: 2.5rem; }
        .media-tile-overlay {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,.4);
        }
        .media-tile-info { padding: 6px 8px; min-width: 0; }
        .media-tile.list-mode .media-tile-info { padding: 0; }
    `],
})
export class MediaGridComponent {
    assets           = input.required<MediaAssetDto[]>();
    selectedIds      = input<string[]>([]);
    viewMode         = input<MediaViewMode>('medium');
    contextMenuNodes = input<NaviGraphNode[]>([]);

    /**
     * Server-side total, for the Details grid's row count. Defaults to
     * 0 so the tile-only callers that predate the grid stay valid; the grid
     * falls back to the loaded length when it is unset.
     */
    totalItems       = input<number>(0);

    selectionChange  = output<string[]>();
    permissionsClick = output<MediaAssetDto>();
    deleteClick      = output<MediaAssetDto>();
    moveClick        = output<MediaAssetDto>();
    /** Phase 1C: fired from the context-menu's "Edit image" action. */
    editImageClick   = output<MediaAssetDto>();
    /** Media decoupling: context-menu Properties click. */
    propertiesClick  = output<MediaAssetDto>();

    readonly svc = inject(MediaService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly toast       = inject(ToastService);
    private readonly store       = inject(Store);

    /**
     * Asset DTOs matching the parent's selectedIds, derived once per
     * change so the directive can compare by reference identity (the
     * tile renders the same asset instance from `assets()` it gets
     * here, so `Array.includes` matches correctly).
     */
    protected readonly currentSelectionArray = computed<readonly MediaAssetDto[]>(() => {
        const ids = this.selectedIds();
        if (ids.length === 0) return [];
        const idSet = new Set(ids);
        return this.assets().filter((a) => idSet.has(a.id));
    });

    onImgError(event: Event): void {
        (event.target as HTMLImageElement).style.display = 'none';
    }

    /** Where the grid fetches its column config from. */
    protected readonly configBaseUrl = computed(() =>
        this.store.selectSnapshot(AppConfigState.manifest)?.dataGrid?.configBase ?? '',
    );

    /**
     * The loaded window, shaped for the DataGrid.
     *
     * `dimensionsLabel` is flattened here because `dimensions` is an object
     * and the grid renders values, not shapes.
     *
     * `totalItems` is the SERVER's count rather than the loaded length: the
     * slot's scroll sentinel appends into `assets()`, so reporting the window
     * as the total would claim a partly-loaded library is complete.
     */
    protected readonly gridData = computed((): DataGridData => {
        const items = this.assets().map(asset => ({
            ...asset,
            dimensionsLabel: null === asset.dimensions
                ? ''
                : `${asset.dimensions.width}×${asset.dimensions.height}`,
        }));

        return {
            items,
            totalItems: this.totalItems() || items.length,
            page:       1,
            limit:      items.length,
            totalPages: 1,
            // The slot owns paging through its sentinel; a grid pager would
            // fight it for the same fetch.
            hasMore:    false,
        };
    });

    /**
     * Grid selection -> the id list the tiles publish, so switching modes keeps
     * the selection and the Properties panel keeps pointing at the same asset.
     */
    protected onGridRowSelected(row: Record<string, unknown> | null): void {
        const id = row?.['id'];
        this.gridRow = 'string' === typeof id ? id : null;
        this.selectionChange.emit(null === this.gridRow ? [] : [this.gridRow]);
    }

    /**
     * The row the grid last selected, remembered because the INPUT cannot be
     * read back in the same tick.
     *
     * The grid emits `rowSelected` and then `rowContextMenu` synchronously
     * from one handler, so at right-click time `selectedIds()` still holds the
     * PREVIOUS selection — the parent has not re-rendered yet. Reading it gave
     * the wrong asset, or none at all on the first right-click, and the
     * context menu silently did not open.
     */
    private gridRow: string | null = null;

    /** Double-click in the grid means what it means on a tile. */
    protected onGridRowActivated(row: Record<string, unknown>): void {
        const asset = this.assetFor(row);
        if (asset) {
            this.onActivate(asset);
        }
    }

    /**
     * Right-click inside the grid. The grid emits `rowSelected` first, so the
     * asset under the cursor is already the selected one.
     */
    protected onGridRowContextMenu(event: MouseEvent): void {
        const id = this.gridRow;
        const asset = null === id ? undefined : this.assets().find(a => a.id === id);
        if (asset) {
            this.onContextMenu({ item: asset, event });
        }
    }

    /** The grid hands back the FLATTENED row, not the DTO — map back by id. */
    private assetFor(row: Record<string, unknown>): MediaAssetDto | undefined {
        const id = row['id'];

        return 'string' === typeof id
            ? this.assets().find(a => a.id === id)
            : undefined;
    }

    /**
     * `details` is absent from both maps on purpose: that mode is the
     * DataGrid, which the slot swaps in instead of this component, so a column
     * width for it would describe a rendering that never happens here.
     */
    gridCols = computed(() => ({
        large:   'repeat(auto-fill, minmax(280px, 1fr))',
        medium:  'repeat(auto-fill, minmax(160px, 1fr))',
        small:   'repeat(auto-fill, minmax(100px, 1fr))',
        content: '1fr',
        details: '1fr',
    }[this.viewMode()]));

    thumbHeight = computed(() => ({
        large: '220px', medium: '120px', small: '70px', content: '40px', details: '40px',
    }[this.viewMode()]));

    isSelected(id: string): boolean {
        return this.selectedIds().includes(id);
    }

    onSelectionChanged(event: CmsSelectionChange<MediaAssetDto>): void {
        const ids = event.selection.map((a) => a.id);
        this.selectionChange.emit(ids);
        // Media decoupling: selection no longer auto-opens the Details
        // panel. The panel is owned by the explicit Properties action.
        // The page's auto-close effect (activeAsset cleared when no
        // longer in selectedIds) handles the deselect-other case.
    }

    onActivate(asset: MediaAssetDto): void {
        // Dblclick on an image asset opens the Image Editor. For
        // non-image MIMEs, the directive's dblclick still fires but
        // the grid only confirms the selection so the row stays
        // highlighted. Matches Document Library's per-MIME activation
        // pattern.
        this.selectionChange.emit([asset.id]);
        if (!asset.mimeType.startsWith('image/')) return;
        // Gate dblclick when the asset isn't fully processed —
        // pending / failed assets shouldn't open in the editor
        // (URL may still be re-pointed by the processing pipeline,
        // dimensions may be unknown). Page-level `openImageEditor`
        // re-checks as defence in depth; toast here so the user
        // sees the reason at the entry point.
        if (asset.status !== 'ready') {
            this.toast.info(
                asset.status === 'failed'
                    ? 'Image failed to process and cannot be edited.'
                    : 'Image is still processing. Please wait a moment and try again.',
                asset.originalFilename,
            );
            return;
        }
        this.editImageClick.emit(asset);
    }

    onContextMenu(payload: { item: MediaAssetDto; event: MouseEvent }): void {
        const focused = payload.item;
        const nodes = this.contextMenuNodes();
        if (nodes.length === 0) return;

        // The directive's right-click already auto-selected the
        // asset if it wasn't already in the selection, so the
        // record reflects the post-selection state. _single is
        // true when exactly one asset is in the selection.
        const ids = this.selectedIds();
        const inSelection = ids.includes(focused.id);
        const single = inSelection ? ids.length === 1 : true;

        this.contextMenu.openFromNodes(
            payload.event,
            nodes,
            {
                _context: 'asset',
                _single:  single,
                _surface: 'context',
                ...(focused as unknown as Record<string, unknown>),
            },
            (action) => this.dispatchAction(action, focused),
        );
    }

    private dispatchAction(action: string, focused: MediaAssetDto): void {
        switch (action) {
            // `'edit'` retired alongside Media's `/edit` NaviGraph node —
            // Properties owns the panel-open path now.
            case 'permissions':
            case 'perms':       this.permissionsClick.emit(focused); break;
            case 'copy-url':    navigator.clipboard.writeText(focused.thumbnailUrl ?? ''); break;
            case 'download':    window.open(focused.originalUrl ?? '', '_blank'); break;
            case 'delete':      this.deleteClick.emit(focused); break;
            case 'move':        this.moveClick.emit(focused); break;
            case 'edit-image':  this.editImageClick.emit(focused); break;
            case 'properties':  this.propertiesClick.emit(focused); break;
        }
    }

    assetAlt(asset: MediaAssetDto): string {
        // `alt` is resolved for the request locale (canonical default in the grid,
        // which loads without `?locale=`); fall back to the filename.
        return asset.alt || asset.originalFilename;
    }

    formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }
}
