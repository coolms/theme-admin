import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    signal,
    ViewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { CmsDropzoneDirective, CmsItemInteractionsDirective, ContextMenuService, DrawerService, FileEditorRegistry, ToastService, VfsNodeDto, type CmsRangeSelectionRequest, type CmsSelectionChange } from '@coolms/ui-angular';
import { Dialog } from '@angular/cdk/dialog';
import {
    CdkDrag,
    CdkDragDrop,
    CdkDragMove,
    CdkDragPlaceholder,
    CdkDragPreview,
    CdkDragStart,
    CdkDropList,
} from '@angular/cdk/drag-drop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Store } from '@ngxs/store';
import { EMPTY, Observable, of, switchMap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { VfsLiveEventsService, type VfsNodeChangeEvent } from './vfs-live-events.service';
import { AppConfigState, CmsLoaderComponent } from '@coolms/core-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsActionsService } from './vfs-actions.service';
import { VfsUploadService } from './vfs-upload.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsUploadOverlayComponent } from './vfs-upload-overlay.component';
import { VfsResourceMetaDialogComponent } from './dialogs/vfs-resource-meta-dialog.component';
import { VfsSecureImgDirective } from './vfs-secure-img.directive';
import { VfsIconService } from './vfs-icon.service';
import { firstValueFrom } from 'rxjs';
import {
    CoolmsImageEditorHostComponent,
    type CoolmsImageEditorHostData,
    type CoolmsImageEditorHostResult,
} from '@coolms/image-editor-angular';
import { ViewerModalComponent, type ViewerModalData } from '@coolms/document-viewer-angular';

@Component({
    selector: 'app-vfs-files',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DatePipe,
        CmsLoaderComponent,
        VfsUploadOverlayComponent,
        VfsSecureImgDirective,
        CdkDrag,
        CdkDropList,
        // Without these two the `*cdkDragPreview` / `*cdkDragPlaceholder`
        // templates below parse as plain attributes and render nothing --
        // NG8116 is only a WARNING, so the build stayed green while the
        // custom preview was dead and the CDK default ghost showed instead.
        CdkDragPreview,
        CdkDragPlaceholder,
        ScrollingModule,
        CmsItemInteractionsDirective,
        CmsDropzoneDirective,
    ],
    template: `
        <div class="position-relative" style="flex: 1; min-height: 0; overflow: auto;"
             cdkDropList
             id="vfs-files-drop-list"
             [cdkDropListData]="nodes()"
             [cdkDropListSortingDisabled]="true"
             [cmsDropzone]="{ multiple: true }"
             (cdkDropListDropped)="onFilePanelDrop($event)"
             (dragenter)="onDragEnter($event)"
             (dragleave)="onDragLeave($event)"
             (dragover)="onDragOver($event)"
             (filesDropped)="onFilesDropped($event)"
             (contextmenu)="openBackgroundContextMenu($event)">

            <!-- Hidden file input for toolbar Upload button -->
            <input #fileInput type="file" multiple style="display:none"
                   (change)="onFileInputChange($event)" />

            <!-- FIRST load only: a background refresh must not blank a list the
                 operator is already reading, which is what the nodes().length
                 test is for. The platform mark rather than a Bootstrap spinner,
                 so a wait looks the same here as it does in the editors. -->
            @if (loading() && nodes().length === 0) {
                <div class="d-flex align-items-center justify-content-center h-100">
                    <cms-loader label="Loading files" />
                </div>
            } @else if (error()) {
                <div class="alert alert-danger m-3">{{ error() }}</div>
            } @else if (nodes().length === 0 && !parentPath() && !isDragging()) {
                <div class="d-flex align-items-center justify-content-center h-100 text-muted">
                    <div class="text-center">
                        <i class="bi bi-folder" style="font-size: 2.5rem"></i>
                        <div class="mt-2 small">Empty directory</div>
                        <div class="mt-1 small text-muted">Drop files here to upload</div>
                    </div>
                </div>
            } @else {
                @if (viewMode() === 'grid') {
                    <!-- ── Grid view ──────────────────────────────────────── -->
                    <div class="d-flex flex-wrap gap-3 p-3 align-content-start">
                        @if (parentPath()) {
                            <div class="vfs-grid-item"
                                 data-node-id="__parent__"
                                 [class.vfs-dir-hover]="hoveredDir()?.id === '__parent__'"
                                 (dblclick)="navigateUp()"
                                 title="Parent directory">
                                <div class="vfs-grid-icon">
                                    <i class="bi bi-folder vfs-icon--directory"></i>
                                </div>
                                <div class="vfs-grid-name small text-muted">..</div>
                            </div>
                        }
                        @for (node of nodes(); track node.id) {
                            <div class="vfs-grid-item"
                                 cdkDrag
                                 [cdkDragData]="node"
                                 [attr.data-node-id]="node.id"
                                 data-selectable
                                 cmsItemInteractions
                                 [cmsItem]="node"
                                 [selectionMode]="'range'"
                                 [currentSelection]="currentSelectionArray()"
                                 [rangeAnchor]="rangeAnchorNode()"
                                 [class.selected]="isSelected(node)"
                                 [class.vfs-hidden-node]="node.isHidden"
                                 [class.vfs-dragging]="isDraggingNode(node)"
                                 [class.vfs-cut-item]="isCut(node)"
                                 [class.vfs-dir-hover]="isDirHovered(node)"
                                 [class.vfs-grid-item--flash]="flashingNodeIds().has(node.id)"
                                 (selectionChanged)="onSelectionChanged($event)"
                                 (rangeSelectionRequested)="onRangeSelectionRequested($event)"
                                 (activated)="onActivate($event)"
                                 (contextMenuRequested)="onContextMenu($event)"
                                 (cdkDragStarted)="onDragStarted($event, node)"
                                 (cdkDragMoved)="onDragMoved($event)"
                                 (cdkDragEnded)="onDragEnded()"
                                 [title]="node.path">

                                <div *cdkDragPreview class="vfs-drag-preview">
                                    <i class="bi {{ nodeIcon(node) }} {{ nodeIconClass(node) }}"></i> {{ node.name }}
                                </div>

                                <div *cdkDragPlaceholder class="vfs-drag-placeholder"></div>

                                <div class="vfs-grid-icon position-relative">
                                    @if (isImage(node)) {
                                        <span class="vfs-thumb-wrap">
                                            <i class="bi bi-file-earmark-image vfs-thumb-fallback"></i>
                                            <img [vfsSecureSrc]="thumbnailUrl(node)"
                                                 alt="{{ node.name }}"
                                                 class="vfs-thumb-img" />
                                        </span>
                                    } @else {
                                        <i class="bi {{ nodeIcon(node) }} {{ nodeIconClass(node) }}"></i>
                                    }
                                    @if (nodeIconBadge(node); as badge) {
                                        <span class="vfs-type-badge" [title]="node.type"><i class="bi {{ badge }}"></i></span>
                                    }
                                </div>
                                <div class="vfs-grid-name text-truncate small">{{ nodeLabel(node) }}</div>
                                <div class="vfs-grid-meta text-muted" style="font-size:.7rem">
                                    {{ node.type === 'file' ? node.humanSize : '' }}
                                </div>
                            </div>
                        }
                    </div>

                    <!-- Grid pagination: "Load more" button -->
                    @if (hasMore()) {
                        <div class="d-flex justify-content-center py-3">
                            @if (loading()) {
                                <cms-loader [inline]="true" />
                            } @else {
                                <button type="button" class="cms-btn cms-btn-sm"
                                        (click)="loadMore()">
                                    Load more…
                                </button>
                            }
                        </div>
                    }

                } @else {
                    <!-- ── List view — CDK virtual scroll ─────────────────── -->
                    <div style="display:flex; flex-direction:column; height:100%; overflow:hidden;">

                    <!-- Fixed header (outside viewport so it stays sticky) -->
                    <div class="vfs-list-header">
                        <div class="vfs-list-col vfs-list-col--name">Name</div>
                        <div class="vfs-list-col vfs-list-col--type">Type</div>
                        <div class="vfs-list-col vfs-list-col--size">Size</div>
                        <div class="vfs-list-col vfs-list-col--perm">Permissions</div>
                        <div class="vfs-list-col vfs-list-col--date">Modified</div>
                    </div>

                    <!-- Parent ".." row (outside viewport, always visible) -->
                    @if (parentPath()) {
                        <div class="vfs-list-row"
                             data-node-id="__parent__"
                             [class.vfs-dir-hover]="hoveredDir()?.id === '__parent__'"
                             (dblclick)="navigateUp()">
                            <div class="vfs-list-col vfs-list-col--name d-flex align-items-center gap-2">
                                <i class="bi bi-folder vfs-icon--directory"></i>
                                <span class="text-muted small">..</span>
                            </div>
                            <div class="vfs-list-col vfs-list-col--type text-muted small">directory</div>
                            <div class="vfs-list-col vfs-list-col--size text-muted small">—</div>
                            <div class="vfs-list-col vfs-list-col--perm"></div>
                            <div class="vfs-list-col vfs-list-col--date"></div>
                        </div>
                    }

                    <!-- Virtual scroll viewport — only visible rows are in the DOM -->
                    <cdk-virtual-scroll-viewport [itemSize]="ITEM_HEIGHT"
                                                 class="vfs-list-viewport"
                                                 (scrolledIndexChange)="onScrollIndexChange($event)">
                        <div *cdkVirtualFor="let node of nodes(); trackBy: trackById"
                             class="vfs-list-row"
                             cdkDrag
                             [cdkDragData]="node"
                             [attr.data-node-id]="node.id"
                             data-selectable
                             cmsItemInteractions
                             [cmsItem]="node"
                             [selectionMode]="'range'"
                             [currentSelection]="currentSelectionArray()"
                             [rangeAnchor]="rangeAnchorNode()"
                             [class.vfs-list-row--selected]="isSelected(node)"
                             [class.vfs-hidden-node]="node.isHidden"
                             [class.vfs-dragging]="isDraggingNode(node)"
                             [class.vfs-cut-item]="isCut(node)"
                             [class.vfs-dir-hover]="isDirHovered(node)"
                             (selectionChanged)="onSelectionChanged($event)"
                             (rangeSelectionRequested)="onRangeSelectionRequested($event)"
                             (activated)="onActivate($event)"
                             (contextMenuRequested)="onContextMenu($event)"
                             (cdkDragStarted)="onDragStarted($event, node)"
                             (cdkDragMoved)="onDragMoved($event)"
                             (cdkDragEnded)="onDragEnded()">

                            <div *cdkDragPreview class="vfs-drag-preview shadow rounded p-2">
                                <i class="bi {{ nodeIcon(node) }} {{ nodeIconClass(node) }}"></i> {{ node.name }}
                            </div>

                            <div class="vfs-list-col vfs-list-col--name d-flex align-items-center gap-2">
                                <span class="position-relative">
                                    <i class="bi {{ nodeIcon(node) }} {{ nodeIconClass(node) }}"></i>
                                    @if (nodeIconBadge(node); as badge) {
                                        <span class="vfs-type-badge" [title]="node.type"><i class="bi {{ badge }}"></i></span>
                                    }
                                </span>
                                <span class="text-truncate" style="max-width: 220px">
                                    {{ nodeLabel(node) }}
                                </span>
                            </div>
                            <div class="vfs-list-col vfs-list-col--type text-muted small">{{ node.type }}</div>
                            <div class="vfs-list-col vfs-list-col--size text-end text-muted small">
                                {{ node.type === 'file' ? node.humanSize : '—' }}
                            </div>
                            <div class="vfs-list-col vfs-list-col--perm">
                                <code class="small text-muted">{{ node.modeString }}</code>
                            </div>
                            <div class="vfs-list-col vfs-list-col--date text-muted small">
                                {{ node.updatedAt | date:'dd MMM yyyy' }}
                            </div>
                        </div>

                        <!-- Loading indicator inside viewport -->
                        @if (loading()) {
                            <div class="vfs-list-row text-muted d-flex align-items-center justify-content-center gap-2">
                                <cms-loader [inline]="true" /> Loading…
                            </div>
                        }
                    </cdk-virtual-scroll-viewport>
                    </div><!-- end list flex-column wrapper -->
                }
            }

            <!-- Drop-zone highlight + upload progress panel -->
            <app-vfs-upload-overlay [isDragging]="isDragging()" />
        </div>
    `,
    styles: [`
        :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }

        /* ── Grid ─────────────────────────────────────────────────────────── */

        .vfs-grid-item {
            width: 96px; padding: 8px;
            border-radius: var(--cms-radius-md, 8px); cursor: pointer;
            text-align: center; user-select: none;
            border: 2px solid transparent;
            transition: background 120ms, border-color 120ms;
        }
        .vfs-grid-item:hover    { background: var(--cms-surface-hover); }
        .vfs-grid-item.selected { background: var(--cms-accent-light); border-color: var(--cms-accent); }
        .vfs-grid-icon          { font-size: 2rem; line-height: 1.2; color: var(--cms-text-muted); }
        .vfs-grid-name          { max-width: 88px; margin: 4px auto 2px; }

        /* ── List (virtual scroll) ────────────────────────────────────────── */

        .vfs-list-header {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            background: var(--cms-surface-muted);
            border-bottom: 1px solid var(--cms-border);
            font-size: .8125rem;
            font-weight: 600;
            flex-shrink: 0;
            color: var(--cms-text-secondary);
            position: sticky;
            top: 0;
            z-index: 1;
            flex-shrink: 0;
        }

        .vfs-list-viewport {
            /* Fill remaining height inside the list flex-column wrapper */
            flex: 1;
            min-height: 0;
        }

        .vfs-list-row {
            display: flex;
            align-items: center;
            height: var(--cms-row-height, 36px);
            padding: 0 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--cms-border-light);
            user-select: none;
            box-sizing: border-box;
        }
        .vfs-list-row:hover          { background: var(--cms-surface-muted); }
        .vfs-list-row--selected      { background: var(--cms-accent-light) !important; }

        .vfs-list-col                { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vfs-list-col--name          { flex: 1; min-width: 0; }
        .vfs-list-col--type          { width: 80px;  flex-shrink: 0; }
        .vfs-list-col--size          { width: 80px;  flex-shrink: 0; text-align: right; }
        .vfs-list-col--perm          { width: 110px; flex-shrink: 0; }
        .vfs-list-col--date          { width: 110px; flex-shrink: 0; }

        /* ── Shared ───────────────────────────────────────────────────────── */

        .vfs-hidden-node        { opacity: .6; }
        .vfs-hidden-node .vfs-grid-name { font-style: italic; }
        .vfs-hidden-node .vfs-list-col--name { font-style: italic; }

        .vfs-type-badge {
            position: absolute; bottom: -2px; right: -4px;
            font-size: .6rem; line-height: 1;
            color: inherit;
            background: var(--cms-surface);
            border-radius: 2px;
        }

        /* .vfs-icon--* color classes are defined globally in styles.scss */

        /* ── Image thumbnail with BI fallback ────────────────────────────────── */

        .vfs-thumb-wrap {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 56px;
            height: 56px;
            margin: 0 auto;
        }
        .vfs-thumb-fallback {
            position: absolute;
            font-size: 2rem;
            color: var(--cms-text-muted);
        }
        .vfs-thumb-img {
            width: 56px;
            height: 56px;
            object-fit: cover;
            border-radius: var(--cms-radius-sm, 4px);
            display: block;
            position: relative;
            z-index: 1;
        }

        .vfs-dragging  { opacity: 0.4; }
        .vfs-cut-item  { opacity: 0.45; filter: grayscale(40%); }

        .vfs-grid-item.vfs-dir-hover {
            background: var(--cms-info-subtle);
            border-color: var(--cms-primary);
            outline: 2px dashed var(--cms-primary);
            outline-offset: -2px;
        }
        .vfs-list-row.vfs-dir-hover { background: var(--cms-info-subtle) !important; border-left: 3px solid var(--cms-primary); }

        .vfs-drag-preview {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius, 6px);
            padding: 6px 12px;
            font-size: .875rem;
            box-shadow: var(--cms-shadow-md, 0 4px 12px rgba(0,0,0,.10));
            pointer-events: none;
        }

        .vfs-drag-placeholder {
            width: 96px; height: 96px;
            background: var(--cms-info-subtle);
            border: 2px dashed var(--cms-primary);
            border-radius: var(--cms-radius-md, 8px);
            pointer-events: none;
        }

        .cdk-drop-list-dragging .vfs-grid-item:not(.cdk-drag-placeholder) {
            transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
        }

        /* Phase 2 VFS live -- 2s fade flash on a grid item whose
           node received a live change event from Centrifugo.
           Matches the VFS tree row flash and the DataGrid row
           flash so all three live surfaces look the same. */
        @keyframes coolms-vfs-grid-item-flash {
            0%   { background-color: var(--cms-accent-light); }
            100% { background-color: transparent; }
        }
        .vfs-grid-item--flash {
            animation: coolms-vfs-grid-item-flash 2s ease-out;
        }
    `],
})
export class VfsFilesComponent {
    private readonly store           = inject(Store);
    protected readonly state         = inject(VfsPageStateService);
    private readonly contextMenu     = inject(ContextMenuService);
    private readonly drawer          = inject(DrawerService);
    private readonly dialog          = inject(Dialog);
    private readonly editorRegistry  = inject(FileEditorRegistry);
    private readonly toast           = inject(ToastService);
    protected readonly uploadService = inject(VfsUploadService);
    private readonly clipboard       = inject(VfsClipboardService);
    private readonly homeLabels      = inject(VfsHomeLabelService);
    protected readonly icons         = inject(VfsIconService);
    private readonly vfsActions      = inject(VfsActionsService);
    private readonly liveEvents      = inject(VfsLiveEventsService);
    private readonly http            = inject(HttpClient);
    private readonly destroyRef      = inject(DestroyRef);

    /**
     * Phase 2 VFS live -- ids of currently flashing grid items.
     * Each entry stays for ~2s while the row-flash CSS animation
     * runs; re-receiving an event for the same id restarts the
     * timer by re-adding it to a fresh Set instance.
     */
    protected readonly flashingNodeIds = signal<ReadonlySet<string>>(new Set());

    constructor() {
        // Phase 2 VFS live -- subscribe to the channel for the
        // current directory's UUID. Re-binds whenever
        // `currentPath()` changes: switchMap tears down the
        // previous channel subscription before starting the new
        // one. `takeUntilDestroyed` cleans up on component
        // teardown.
        toObservable(this.state.currentPath).pipe(
            switchMap(path => this.statFolder(path)),
            switchMap(folderId => folderId === null ? EMPTY : this.liveEvents.watch(folderId)),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(event => this.handleLiveEvent(event));
    }

    private statFolder(path: string): Observable<string | null> {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';
        if (!baseUrl || '' === path) {
            return of(null);
        }
        const url = `${baseUrl}/vfs/files?path=${encodeURIComponent(path)}`;

        return this.http.get<VfsNodeDto>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            map(node => node.id),
            // 404 / permission denied / network error -> no subscription;
            // the slot stays empty for live updates until next navigation.
            catchError(() => of<string | null>(null)),
        );
    }

    private handleLiveEvent(event: VfsNodeChangeEvent): void {
        switch (event.type) {
            case 'node.created':
            case 'node.deleted':
            case 'node.moved':
            case 'node.renamed':
                this.state.reload();
                this.flashNode(event.nodeId);
                break;
            case 'node.metadata_changed':
            case 'node.content_updated':
                this.refetchSingleNode(event.nodeId);
                this.flashNode(event.nodeId);
                break;
        }
    }

    private refetchSingleNode(nodeId: string): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';
        if (!baseUrl) return;
        const url = `${baseUrl}/vfs/files?id=${encodeURIComponent(nodeId)}`;
        this.http.get<VfsNodeDto>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: updated => {
                this.state.nodes.update(current => {
                    const idx = current.findIndex(n => n.id === nodeId);
                    if (-1 === idx) return current;
                    const next = [...current];
                    next[idx] = updated;
                    return next;
                });
            },
            error: () => {
                // 404 here is benign -- a structural event likely
                // precedes / follows this refetch and will remove
                // the row. Silent.
            },
        });
    }

    private flashNode(nodeId: string): void {
        const next = new Set(this.flashingNodeIds());
        next.add(nodeId);
        this.flashingNodeIds.set(next);
        setTimeout(() => {
            const without = new Set(this.flashingNodeIds());
            without.delete(nodeId);
            this.flashingNodeIds.set(without);
        }, 2000);
    }

    @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

    nodes       = this.state.nodes;
    loading     = this.state.loading;
    error       = this.state.error;
    viewMode    = this.state.viewMode;
    selected    = this.state.selectedNodes;
    currentPath = this.state.currentPath;
    hasMore     = this.state.hasMore;

    /** Fixed row height used by CdkVirtualScrollViewport for list view.
     *  Must match --cms-row-height (36px). */
    readonly ITEM_HEIGHT = 36;

    isDragging   = signal(false);
    draggingNode = signal<VfsNodeDto | null>(null);
    /** Directory the pointer is hovering over during a CDK drag within this panel. */
    hoveredDir   = signal<VfsNodeDto | null>(null);
    private dragCounter = 0;

    parentPath = computed<string | null>(() => {
        const path = this.currentPath();
        if (!path || path === '/') return null;
        const parts = path.replace(/\/$/, '').split('/');
        parts.pop();
        return parts.length === 0 ? '/' : parts.join('/') || '/';
    });

    // ── Virtual scroll pagination ────────────────────────────────────────────

    /**
     * Triggered by CdkVirtualScrollViewport as the user scrolls in list view.
     * Fetches the next page when within 20 items of the end.
     */
    onScrollIndexChange(lastVisibleIndex: number): void {
        if (
            lastVisibleIndex >= this.nodes().length - 20 &&
            this.hasMore() &&
            !this.loading()
        ) {
            this.state.loadMore();
        }
    }

    /** Explicit "Load more" trigger used by the grid view button. */
    loadMore(): void {
        this.state.loadMore();
    }

    /** trackBy function for *cdkVirtualFor. */
    trackById(_index: number, node: VfsNodeDto): string {
        return node.id;
    }

    // ── Selection ───────────────────────────────────────────────────────────────

    isSelected(node: VfsNodeDto): boolean {
        return this.selected().some(n => n.id === node.id);
    }

    isCut(node: VfsNodeDto): boolean {
        return this.clipboard.hasCut() &&
               (this.clipboard.clipboard()?.nodes.some(n => n.id === node.id) ?? false);
    }

    // ── Selection (directive-driven) ────────────────────────────────────────────

    /**
     * Selection bridge — directive consumes a reference-stable array of the
     * currently-selected nodes for its includes() check during right-click
     * preservation logic.
     */
    protected readonly currentSelectionArray = computed<readonly VfsNodeDto[]>(() =>
        this.state.selectedNodes(),
    );

    /**
     * Shift-range anchor for the directive. Matches today's "last item in
     * current selection" semantic so a single bit-for-bit migration is
     * preserved (rather than introducing a separate `lastSelected` signal).
     */
    protected readonly rangeAnchorNode = computed<VfsNodeDto | null>(() => {
        const sel = this.state.selectedNodes();
        return sel.length > 0 ? sel[sel.length - 1] : null;
    });

    onSelectionChanged(event: CmsSelectionChange<VfsNodeDto>): void {
        this.state.setSelection([...event.selection]);
        if (event.selection.length !== 1) {
            this.drawer.close();
        }
    }

    onRangeSelectionRequested(event: CmsRangeSelectionRequest<VfsNodeDto>): void {
        const ordered = this.nodes();
        const fromIdx = ordered.findIndex(n => n.id === event.from.id);
        const toIdx   = ordered.findIndex(n => n.id === event.to.id);
        if (fromIdx === -1 || toIdx === -1) return;
        const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const range = ordered.slice(lo, hi + 1);
        if (event.modifier === 'replace') {
            this.state.setSelection(range);
        } else {
            const current = this.state.selectedNodes();
            const merged  = [...current];
            for (const n of range) {
                if (!merged.some(m => m.id === n.id)) merged.push(n);
            }
            this.state.setSelection(merged);
        }
        if (this.state.selectedNodes().length !== 1) {
            this.drawer.close();
        }
    }

    onActivate(node: VfsNodeDto): void {
        this.open(node);
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    navigateUp(): void {
        const parent = this.parentPath();
        if (parent) this.state.navigateTo(parent);
    }

    isImage(node: VfsNodeDto): boolean {
        return !!node.mimeType?.startsWith('image/');
    }

    thumbnailUrl(node: VfsNodeDto): string {
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
        return `${base}/vfs/files/preview?path=${encodeURIComponent(node.path)}`;
    }

    /**
     * Directive-driven right-click on a node. The directive's
     * `applyRightClick` has already preserved selection if the node is in
     * it, or replaced it otherwise. We pass the focused node into the
     * record so per-node showWhen predicates can filter.
     */
    onContextMenu(payload: { item: VfsNodeDto; event: MouseEvent }): void {
        const focused = payload.item;
        const nodes = this.state.vfsToolbarNodes();
        if (nodes.length === 0) return;
        const selected = this.state.selectedNodes();
        const single = selected.length <= 1;
        const record: Record<string, unknown> = {
            _context:      'node',
            _single:       single,
            _hasClipboard: this.clipboard.hasAny(),
            type:          focused.type,
            name:          focused.name,
            path:          focused.path,
            mimeType:      focused.mimeType,
            size:          focused.size,
            isSystem:      focused.isSystem,
            isHidden:      focused.isHidden,
            isContainer:   focused.isContainer,
            // Precomputed predicates for showWhen on the new generic Edit /
            // Open as folder entries (NaviGraph eval has no function-call DSL,
            // so these must arrive as flat boolean fields).
            hasEditor:     this.editorRegistry.resolve(focused) !== null,
            canDrillIn:    focused.isContainer && focused.permissions.execute,
        };
        this.contextMenu.openFromNodes(
            payload.event,
            [...nodes],
            record,
            (actionId) => this.dispatchAction(actionId, focused),
        );
    }

    openBackgroundContextMenu(event: MouseEvent): void {
        const nodes = this.state.vfsToolbarNodes();
        if (nodes.length === 0) return;
        const record: Record<string, unknown> = {
            _context:      'background',
            _single:       false,
            _hasClipboard: this.clipboard.hasAny(),
            type:          'directory',
            name:          '',
            path:          '',
            isSystem:      false,
            isHidden:      false,
        };
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            record,
            (actionId) => this.dispatchAction(actionId, null),
        );
    }

    private dispatchAction(actionId: string, target: VfsNodeDto | null): void {
        if (actionId === 'upload') {
            this.state.uploadRequested$.next();
            return;
        }
        const node = this.state.vfsToolbarNodes().find(
            (n) => String(n.meta['action']) === actionId,
        );
        if (!node) return;
        this.vfsActions.execute(node, target);
    }

    open(node: VfsNodeDto): void {
        // 1. Container + execute → navigate inside.
        //    Containers with a registered editor: prefer the editor on dbl-click.
        //    Drill-in stays accessible via the 'Open as folder' context-menu entry.
        if (node.isContainer && node.permissions.execute && !this.editorRegistry.resolve(node)) {
            const path = node.path.startsWith('/') ? node.path : '/' + node.path;
            this.state.navigateTo(path);
            return;
        }

        // 2. No read permission → silent return
        if (!node.permissions.read) {
            return;
        }

        // 3. Resource node → open Resource Meta Dialog
        if (node.type === 'resource') {
            this.dialog.open(VfsResourceMetaDialogComponent, {
                data:       { node },
                panelClass: 'cms-editor-dialog',
            });
            return;
        }

        // 4. Image MIME → open the headless image editor with VFS
        // context (Phase 1C). Skips the FileEditorRegistry because
        // the editor host expects our discriminated `vfs` data shape,
        // not the registry's `{ node }` envelope.
        if (this.isImage(node)) {
            void this.openImageEditor(node);
            return;
        }

        // 5. Registered editor → open it
        if (this.editorRegistry.openFor(node)) {
            return;
        }

        // 6. Registered viewer for this MIME → open ViewerModal.
        // Federation-style lookup via the backend's viewer manifest
        // (same registry Document Library uses for instance preview).
        if (this.openViewerFor(node)) {
            return;
        }

        // 7. No editor or viewer registered → info toast
        this.toast.info('No viewer for this file type', node.name);
    }

    /**
     * Returns true and opens `ViewerModalComponent` if a viewer is
     * registered for `node.mimeType` via the federation manifest in
     * `AppConfigState.viewers`; otherwise returns false so the caller
     * can fall through to the next branch.
     */
    private openViewerFor(node: VfsNodeDto): boolean {
        const mime = node.mimeType;
        if (!mime) {
            return false;
        }
        const manifest = this.store.selectSnapshot(AppConfigState.viewers);
        if (!manifest) {
            return false;
        }
        const matched = Object.values(manifest.viewers).find((def) => def.mimeTypes.includes(mime));
        if (!matched) {
            return false;
        }
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
        const fileUrl = `${base}/vfs/files/download?path=${encodeURIComponent(node.path)}&disposition=inline`;
        const downloadUrl = `${base}/vfs/files/download?path=${encodeURIComponent(node.path)}&disposition=attachment&filename=${encodeURIComponent(node.name)}`;
        const data: ViewerModalData = {
            fileUrl,
            downloadUrl,
            mimeType: mime,
            filename: node.name,
            title: node.name,
        };
        this.dialog.open<void, ViewerModalData>(ViewerModalComponent, {
            data,
            hasBackdrop: true,
        });

        return true;
    }

    /**
     * Open the headless image editor against a VFS image file.
     * Branches `Save` on `permissions.write`: read-only files allow
     * Save as (creates a copy in the same directory if write
     * permission exists there) but disable Save.
     */
    private async openImageEditor(node: VfsNodeDto): Promise<void> {
        const data: CoolmsImageEditorHostData = {
            context: 'vfs',
            node: {
                path:       node.path,
                canWrite:   node.permissions.write,
                sourceUrl:  this.thumbnailUrl(node),
                filename:   node.name,
                mimeType:   node.mimeType ?? 'application/octet-stream',
                parentPath: this.parentPathOf(node.path),
            },
        };
        const dialogRef = this.dialog.open<CoolmsImageEditorHostResult, CoolmsImageEditorHostData>(
            CoolmsImageEditorHostComponent,
            { data, backdropClass: 'cdk-overlay-dark-backdrop', disableClose: true },
        );
        const result = await firstValueFrom(dialogRef.closed);
        if (result?.kind === 'saved') {
            // Reload the current directory so the saved file's
            // updated mtime / new sibling lands in the listing.
            this.state.reload();
        }
    }

    private parentPathOf(path: string): string {
        const trimmed = path.replace(/\/+$/, '');
        const idx = trimmed.lastIndexOf('/');
        return idx <= 0 ? '/' : trimmed.slice(0, idx);
    }

    /**
     * Returns the display label for a node.
     *
     * ONLY `/home/{uuid}` is relabelled. Everything else shows `name`, and
     * deliberately so: this is a file explorer, and a node's title is a
     * free-text label that has nothing to do with its filename — the dev data
     * has a file `i18nNodeSmoke.txt` titled "Intro video". Preferring `title`
     * globally would hide real filenames behind labels.
     *
     * Within the home-directory case, `title` wins over the uname-derived map
     * because it is resolved and persisted server-side: it is present on the
     * first render and on ANY entry point, including deep-linking straight to
     * /home/{uuid} without ever listing /home. The map is only populated once
     * a listing containing the /home children has loaded, which is exactly why
     * it alone left a raw UUID on direct navigation. It stays as a fallback
     * for directories whose title has not been stamped yet.
     *
     * Display only — `name` remains the rename identity, which is why the
     * rename dialog pre-fills from `node.name` and shows the UUID.
     */
    nodeLabel(node: VfsNodeDto): string {
        if (!VfsHomeLabelService.isHomeDir(node)) {
            return node.name;
        }

        return node.title || this.homeLabels.labelFor(node.name)();
    }

    nodeIcon(node: VfsNodeDto):      string        { return this.icons.nodeIcon(node); }
    nodeIconClass(node: VfsNodeDto): string        { return this.icons.nodeIconClass(node); }
    nodeIconBadge(node: VfsNodeDto): string | null { return this.icons.nodeIconBadge(node); }

    // ── CDK Drag & Drop ────────────────────────────────────────────────────────

    isDraggingNode(node: VfsNodeDto): boolean {
        return this.draggingNode()?.id === node.id;
    }

    isDirHovered(node: VfsNodeDto): boolean {
        return node.type === 'directory' && this.hoveredDir()?.id === node.id;
    }

    onDragStarted(event: CdkDragStart, node: VfsNodeDto): void {
        this.draggingNode.set(node);
        this.state.selectNode(node);
    }

    onDragEnded(): void {
        const hovered  = this.hoveredDir();
        const dragging = this.draggingNode();

        this.draggingNode.set(null);
        this.hoveredDir.set(null);

        if (hovered && dragging &&
            dragging.path !== hovered.path &&
            !hovered.path.startsWith(dragging.path + '/')) {
            void this.clipboard.move(dragging.path, hovered.path);
        }
    }

    onDragMoved(event: CdkDragMove<VfsNodeDto>): void {
        const { x, y } = event.pointerPosition;
        const el       = document.elementFromPoint(x, y);
        const item     = el?.closest<HTMLElement>('[data-node-id]');
        const nodeId   = item?.dataset['nodeId'];

        if (nodeId) {
            if (nodeId === '__parent__') {
                const parentPath = this.parentPath();
                if (parentPath && this.hoveredDir()?.id !== '__parent__') {
                    this.hoveredDir.set({ id: '__parent__', type: 'directory', path: parentPath } as VfsNodeDto);
                }
                return;
            }

            const draggingId = this.draggingNode()?.id;
            const dir = this.nodes().find(
                n => n.id === nodeId && n.type === 'directory' && n.id !== draggingId,
            );
            if (dir) {
                if (this.hoveredDir()?.id !== dir.id) this.hoveredDir.set(dir);
                return;
            }
        }
        if (this.hoveredDir() !== null) this.hoveredDir.set(null);
    }

    onFilePanelDrop(event: CdkDragDrop<VfsNodeDto[]>): void {
        if (event.previousContainer === event.container) return;

        this.draggingNode.set(null);
        this.hoveredDir.set(null);
        const node          = event.item.data as VfsNodeDto;
        const targetDirPath = this.state.currentPath();
        void this.clipboard.move(node.path, targetDirPath);
    }

    // ── HTML5 Drag-and-drop (file upload from OS) ──────────────────────────────

    onDragEnter(event: DragEvent): void {
        event.preventDefault();
        this.dragCounter++;
        if (event.dataTransfer?.types.includes('Files')) {
            this.isDragging.set(true);
        }
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        this.dragCounter--;
        if (this.dragCounter === 0) {
            this.isDragging.set(false);
        }
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    /**
     * OS-file drop reached the dropzone directive. The directive gates on
     * `dataTransfer.types.includes('Files')` so in-app CdkDrag operations
     * don't reach here. Reset the legacy enter-counter / isDragging state
     * (kept for the upload overlay highlight) and forward the FileList.
     */
    onFilesDropped(files: File[]): void {
        this.dragCounter = 0;
        this.isDragging.set(false);
        if (files.length === 0) return;
        const list = new DataTransfer();
        for (const f of files) list.items.add(f);
        this.uploadService.uploadFiles(list.files);
    }

    // ── File input (toolbar Upload button) ────────────────────────────────────

    triggerFileInput(): void {
        this.fileInputRef?.nativeElement.click();
    }

    onFileInputChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files?.length) {
            this.uploadService.uploadFiles(input.files);
            input.value = '';
        }
    }
}
