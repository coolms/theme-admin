import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    OnDestroy,
    ViewChild,
} from '@angular/core';

import { ContextMenuService, DropZoneDirective, ExplorerToolbarRowComponent } from '@coolms/ui-angular';
import { CmsLoaderComponent, NaviGraphNode, NaviGraphService } from '@coolms/core-angular';
import { MediaPageStateService } from './media-page-state.service';
import { MediaGridComponent } from './media-grid.component';

/**
 * Slot adapter that renders MediaGridComponent within the media library layout.
 *
 * Reads all state from MediaPageStateService and dispatches actions back to it.
 * Handles: infinite scroll sentinel, drop-zone, background context menu.
 *
 * Registered as 'MediaGrid' in ComponentRegistry.
 */
@Component({
    selector: 'app-media-grid-slot',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, MediaGridComponent, DropZoneDirective, ExplorerToolbarRowComponent],
    template: `
        <div class="media-grid-slot"
             appDropZone
             #dropZoneEl="appDropZone"
             (filesDropped)="state.filesDropped$.next($event)"
             (contextmenu)="onBackgroundContextMenu($event)">

            <!-- Drop overlay -->
            @if (dropZoneEl.dragOver()) {
                <div class="drop-overlay">
                    <div class="drop-card">
                        <i class="bi bi-cloud-upload" style="font-size:2rem;color:var(--cms-accent)"></i>
                        <div class="fw-semibold mt-1">Drop to upload</div>
                    </div>
                </div>
            }

            <!-- Breadcrumb row — sits above the grid, anchored to the grid's
                 left edge so its horizontal position is stable regardless of
                 contextual toolbar action width. -->
            <app-explorer-toolbar-row
                [path]="state.currentDir()"
                [navigableFrom]="state.spaceRoot()"
                (navigate)="state.currentDir.set($event)" />

            <div class="media-grid-scroll" #scrollContainer>
                <app-media-grid
                    [assets]="state.assets()"
                    [selectedIds]="state.selectedIds()"
                    [viewMode]="state.viewMode()"
                    [totalItems]="state.totalItems()"
                    [contextMenuNodes]="assetContextNodes()"
                    (selectionChange)="onSelectionChange($event)"
                    (permissionsClick)="state.permissionsRequested$.next($event)"
                    (deleteClick)="state.assetDeleteRequested$.next([$event])"
                    (moveClick)="state.moveRequested$.next($event)"
                    (editImageClick)="state.editImageRequested$.next($event)"
                    (propertiesClick)="state.propertiesToggleRequested$.next($event)" />

                @if (state.loading()) {
                    <div class="text-center py-4">
                        <cms-loader [inline]="true" />
                    </div>
                }

                <!-- Scroll sentinel — triggers next page load -->
                <div #scrollSentinel class="scroll-sentinel"></div>
            </div>
        </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
        .media-grid-slot {
            flex: 1; display: flex; flex-direction: column; overflow: hidden;
            position: relative;
        }
        .media-grid-scroll { flex: 1; min-height: 0; overflow-y: auto; }
        /*
         * Fill the pane when short, still GROW when long (#1760).
         *
         * app-media-grid had no host display at all, so it laid out inline and
         * the DataGrid inside it ended after its last row with dead space
         * below — the same complaint Documents had.
         *
         * min-height:100% rather than flex:1 is deliberate. This container
         * owns the scroll AND holds the infinite-scroll sentinel as a sibling
         * below the grid. Giving the grid flex:1 would make it scroll
         * internally, the container would never overflow, and the sentinel
         * would sit permanently in view — firing "load next page" forever.
         * min-height stretches a short grid without capping a long one.
         */
        .media-grid-scroll > app-media-grid {
            display: flex;
            flex-direction: column;
            min-height: 100%;
        }
        /*
         * The sentinel must not create the overflow it exists to detect.
         *
         * It is 1px tall and sits AFTER a grid that is now min-height:100%,
         * so a folder with one file measured scrollHeight 714 against
         * clientHeight 713 — a scrollbar for a single pixel, on a pane with
         * nothing to scroll. The negative margin cancels exactly its own
         * height, so it still sits at the end of the flow and still
         * intersects when you reach the bottom, but contributes nothing.
         */
        .scroll-sentinel {
            height: 1px;
            margin-top: -1px;
        }
        .drop-overlay {
            position: absolute; inset: 8px; z-index: 100;
            background: color-mix(in srgb, var(--cms-accent) 6%, transparent);
            border: 2px dashed var(--cms-accent);
            border-radius: var(--cms-radius-lg);
            display: flex; align-items: center; justify-content: center;
            pointer-events: none;
        }
        .drop-card {
            background: var(--cms-surface); border-radius: 12px; padding: 24px 40px;
            text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,.1);
        }
    `],
})
export class MediaGridSlotComponent implements AfterViewInit, OnDestroy {
    readonly state      = inject(MediaPageStateService);
    private readonly naviGraph   = inject(NaviGraphService);
    private readonly contextMenu = inject(ContextMenuService);

    @ViewChild('scrollSentinel') sentinelEl!: ElementRef;
    private observer!: IntersectionObserver;

    /**
     * Candidate context-menu nodes for asset right-click. Filters
     * by the synthetic surface / context bucket here, but keeps
     * any node whose showWhen also references per-asset fields
     * (e.g., the Edit Image action gated by `mimeType startsWith
     * image/`) — those get re-evaluated by the grid against the
     * actual right-clicked asset, since we can't know the asset
     * at this stage.
     */
    readonly assetContextNodes = computed((): NaviGraphNode[] => {
        const nodes = this.state.toolbarNodes();
        if (!nodes.length) return [];
        const visible = nodes.filter(n => this.couldShowForAsset(n));
        return this.cleanSeparators(visible);
    });

    private couldShowForAsset(node: NaviGraphNode): boolean {
        const surfaceRecord: Record<string, unknown> = {
            _context: 'asset',
            _single:  true,
            _surface: 'context',
        };
        const showWhen = node.meta['showWhen'] as Record<string, unknown> | undefined;
        if (!showWhen) return true;
        if (this.naviGraph.isVisible(node, surfaceRecord)) return true;
        // Gives nodes whose showWhen references per-asset fields a
        // second chance at the grid stage. Without this, the
        // synthetic-only record would collapse `mimeType startsWith
        // image/` to false and reject the Edit Image action here.
        return this.referencesPerAssetField(showWhen);
    }

    private referencesPerAssetField(cond: Record<string, unknown>): boolean {
        if ('and' in cond) {
            return (cond['and'] as Record<string, unknown>[]).some(c => this.referencesPerAssetField(c));
        }
        if ('or' in cond) {
            return (cond['or'] as Record<string, unknown>[]).some(c => this.referencesPerAssetField(c));
        }
        const field = cond['field'] as string | undefined;
        if (field === undefined) return false;
        // Synthetic fields are prefixed with `_` (`_context`,
        // `_single`, `_surface`); anything else comes from the
        // asset DTO at right-click time.
        return !field.startsWith('_');
    }

    ngAfterViewInit(): void {
        this.observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !this.state.loading() && this.state.hasMore()) {
                this.state.loadNextPageRequested$.next();
            }
        }, { threshold: 0.1 });
        this.observer.observe(this.sentinelEl.nativeElement);
    }

    ngOnDestroy(): void { this.observer?.disconnect(); }

    onSelectionChange(ids: string[]): void {
        this.state.selectedIds.set(ids);
        // Media decoupling: panel state is independent of selection
        // count. The page's auto-close effect already nulls
        // activeAsset when it leaves the selection (deselect-other,
        // delete, collection change), which covers the
        // "panel-can't-show-nothing" invariant. Multi-select keeps
        // the panel showing the previously-focused asset until the
        // user toggles it off via Properties.
    }

    onBackgroundContextMenu(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        // A Details-grid ROW joins `.media-tile` as "not background" (#1710).
        // The escape hatch was written when tiles were the only thing in this
        // pane, so a right-click on a grid row fell through here — and it fired
        // AFTER the asset menu the row handler had just opened, replacing
        // "Properties / Download / Move / Delete" with "New Collection /
        // Upload". Matching the ROW rather than the grid host on purpose: the
        // empty area BELOW the rows is still background, and still gets this
        // menu, exactly as the empty area between tiles does.
        if (target.closest('.media-tile, coolms-datagrid tbody tr')) return;
        const nodes = this.state.toolbarNodes();
        if (nodes.length === 0) return;
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            {
                _context: 'background',
                _surface: 'context',
            },
            (action) => this.dispatchBackgroundAction(action),
        );
    }

    /**
     * Inline dispatcher for background context-menu actions. Routes
     * to the existing state-service subjects the inline menu used
     * before this migration — no new state plumbing needed.
     */
    private dispatchBackgroundAction(action: string): void {
        switch (action) {
            case 'new-collection':
                this.state.newCollectionRequested$.next();
                break;
            case 'upload':
                this.state.uploadRequested$.next();
                break;
        }
    }

    private cleanSeparators(nodes: NaviGraphNode[]): NaviGraphNode[] {
        return nodes.filter((n, i, arr) => {
            if (n.meta['type'] !== 'separator') return true;
            if (i === 0 || i === arr.length - 1) return false;
            return arr[i - 1].meta['type'] !== 'separator';
        });
    }
}
