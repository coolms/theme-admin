import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    Input,
    OnInit,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { HttpClient } from '@angular/common/http';
import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { Store } from '@ngxs/store';
import { skip } from 'rxjs';
import { AppConfigState } from '@coolms/core-angular';
import { VfsPageStateService } from './vfs-page-state.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsActionsService } from './vfs-actions.service';
import { VfsHomeLabelService } from './vfs-home-label.service';
import { VfsIconService } from './vfs-icon.service';
import { ContextMenuService, VfsDirectoryPage, VfsNodeDto } from '@coolms/ui-angular';
import { VfsTreeLiveSubscriptionsService } from './vfs-tree-live-subscriptions.service';
import { type VfsNodeChangeEvent } from './vfs-live-events.service';

/**
 * A row in the flattened visible tree.
 * 'node' — a directory entry; 'more' — a "Load more…" button for a given parent path.
 */
type FlatItem =
    | { readonly kind: 'node'; readonly node: VfsNodeDto; readonly depth: number }
    | { readonly kind: 'more'; readonly path: string;     readonly depth: number };

/**
 * Sidebar directory tree for the VFS file manager.
 *
 * ### Architecture (flat childrenMap, Option A)
 *
 * Instead of mounting a recursive `<app-vfs-tree>` per expanded node (which
 * caused cascading HTTP requests and made auto-expand impossible for unloaded
 * ancestors), this component is FLAT:
 *
 * - `childrenMap`  — Map<parentPath, VfsNodeDto[]>  — all loaded directory children
 * - `expandedPaths` — Set<string>  — which paths are currently open
 * - `pathLoaded`  — Set<string>  — which paths have been fetched (prevents double-fetch)
 *
 * `flatNodes` (computed) depth-first flattens `childrenMap` into a single
 * renderable list, inserting "Load more" sentinels where pagination applies.
 *
 * ### Auto-expand on navigation
 *
 * When `currentPath` changes (e.g. user double-clicks a folder in the files
 * panel), `autoExpandPath()` walks each ancestor segment and:
 *   1. Adds the ancestor to `expandedPaths` immediately.
 *   2. If its children haven't been fetched yet, fires `loadChildrenByPath()`.
 *
 * Because expansion is path-based (not node-ID-based) no node object needs to
 * be in memory — the path alone is enough to trigger a fetch and show the
 * result once it arrives.
 */
@Component({
    selector: 'app-vfs-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CdkDropList],
    providers: [VfsTreeLiveSubscriptionsService],
    template: `
        @for (item of flatNodes(); track trackItem($index, item)) {
            @if (item.kind === 'node') {
                <div class="d-flex align-items-center gap-1 vfs-tree-item"
                     [class.active]="isCurrentPath(item.node)"
                     [class.vfs-tree-drop-hover]="isDragOver(item.node)"
                     [class.vfs-tree-item--flash]="flashingNodeIds().has(item.node.id)"
                     [style.--item-indent]="indentPx(item.depth) + 'px'"
                     cdkDropList
                     [id]="'vfs-tree-node-' + item.node.id"
                     [cdkDropListData]="item.node"
                     [cdkDropListSortingDisabled]="true"
                     (cdkDropListEntered)="onTreeDropEnter(item.node)"
                     (cdkDropListExited)="onTreeDropExit(item.node)"
                     (cdkDropListDropped)="onTreeDrop($event, item.node)"
                     (contextmenu)="onContextMenu(item.node, $event)"
                     (click)="navigate(item.node, $event)">

                    @if (item.depth > 0) {
                        <span class="text-muted" style="font-size:.65rem; opacity:.5">└</span>
                    }

                    @if (item.node.isContainer) {
                        <span class="vfs-tree-toggle text-muted"
                              style="width:14px; font-size:.7rem; cursor:pointer"
                              (click)="toggleExpand(item.node, $event)">
                            {{ isExpanded(item.node) ? '▾' : '▸' }}
                        </span>
                    } @else {
                        <span style="width:14px; display:inline-block;"></span>
                    }

                    <span class="vfs-tree-icon position-relative">
                        <i class="bi {{ icons.nodeIcon(item.node) }} {{ icons.nodeIconClass(item.node) }}"></i>
                        @if (icons.nodeIconBadge(item.node); as badge) {
                            <span class="vfs-tree-badge"><i class="bi {{ badge }}"></i></span>
                        }
                    </span>
                    <span class="text-truncate small" [title]="item.node.path"
                          style="max-width: 140px">
                        {{ nodeLabel(item.node) }}
                    </span>
                </div>
            } @else {
                <!-- "Load more" sentinel — no CSS class conflict, plain binding is fine -->
                <div [style.padding-left]="indentPx(item.depth) + 'px'" class="py-1">
                    <button type="button"
                            class="btn btn-link btn-sm p-0 text-muted small text-decoration-none"
                            (click)="loadMoreFor(item.path, $event)">
                        Load more…
                    </button>
                </div>
            }
        }

        @if (loading()) {
            <div class="text-muted small py-1" style="padding-left: 12px">
                Loading…
            </div>
        }
    `,
    styles: [`
        :host {
            display: block;
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 0 4px;
        }

        .vfs-tree-item {
            cursor: pointer; border-radius: 4px;
            transition: background 100ms;
            user-select: none;
            padding-left: var(--item-indent, 12px);
            padding-top: 6px;
            padding-right: 8px;
            padding-bottom: 6px;
        }
        .vfs-tree-item:hover  { background: #f1f5f9; }
        .vfs-tree-item.active { background: var(--cms-info-subtle); font-weight: 600; }

        .vfs-tree-drop-hover {
            background: var(--cms-info-subtle) !important;
            border-radius: 4px;
            outline: 2px dashed #3b82f6;
        }

        /* Phase 2 VFS live -- 2s fade flash on a row whose node
           received a live change event from Centrifugo. Mirrors
           the DataGrid pattern so both live surfaces look the
           same: warm-cream attention tone via the existing
           --cms-accent-light token. */
        @keyframes coolms-vfs-tree-row-flash {
            0%   { background-color: var(--cms-accent-light); }
            100% { background-color: transparent; }
        }
        .vfs-tree-item--flash {
            animation: coolms-vfs-tree-row-flash 2s ease-out;
        }

        .vfs-tree-icon {
            font-size: .9rem;
            line-height: 1;
            display: inline-flex;
            align-items: center;
        }

        .vfs-tree-badge {
            position: absolute;
            bottom: -3px;
            right: -5px;
            font-size: .5rem;
            line-height: 1;
            color: inherit;
            background: var(--cms-surface);
            border-radius: 2px;
        }
    `],
})
export class VfsTreeComponent implements OnInit {
    /** Starting path — the component shows children of this directory at depth 0. */
    @Input() rootPath = '/';

    private readonly store      = inject(Store);
    private readonly http       = inject(HttpClient);
    private readonly state      = inject(VfsPageStateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly clipboard  = inject(VfsClipboardService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly vfsActions = inject(VfsActionsService);
    private readonly homeLabels = inject(VfsHomeLabelService);
    protected readonly icons    = inject(VfsIconService);
    private readonly liveSubs   = inject(VfsTreeLiveSubscriptionsService);

    readonly currentPath  = this.state.currentPath;

    /** All loaded directory children, keyed by parent path. */
    readonly childrenMap   = signal<Map<string, VfsNodeDto[]>>(new Map());
    /** Set of directory paths whose children are currently visible in the tree. */
    readonly expandedPaths = signal<Set<string>>(new Set());
    /** Loading indicator for the root level only. */
    readonly loading       = signal(false);
    /** Drop-target highlight. */
    readonly dragOverNode  = signal<VfsNodeDto | null>(null);

    /**
     * Phase 2 VFS live -- root node UUID, resolved once on mount
     * via a path-based stat. Used as the parent-id for the root
     * channel subscription (root has no listed parent of its own;
     * we treat root's own id as the channel selector so any
     * direct-child mutation under `/` reaches the tree).
     */
    private readonly rootNodeId = signal<string | null>(null);

    /**
     * Phase 2 VFS live -- ids of currently flashing nodes. Each
     * entry stays for ~2s while the row-flash CSS animation
     * runs; re-receiving an event for the same id restarts the
     * timer by re-adding it to a fresh Set instance.
     */
    protected readonly flashingNodeIds = signal<ReadonlySet<string>>(new Set());

    // ── Non-reactive per-path pagination state ─────────────────────────────────
    /** Paths whose API response has been received at least once (prevents double-fetch). */
    private readonly pathLoaded    = new Set<string>();
    /** Whether each path has more pages available. */
    private readonly pathHasMore   = new Map<string, boolean>();
    /** Next-page cursor for each path. */
    private readonly pathCursorMap = new Map<string, string | null>();

    // ── Computed: depth-first flat tree ───────────────────────────────────────

    /**
     * Flattens the entire visible tree into a single renderable list.
     *
     * Directories are included only if their type is 'directory'.
     * A { kind:'more' } sentinel is appended after the last child of any
     * expanded directory that has a next page available.
     */
    readonly flatNodes = computed((): FlatItem[] => {
        const expanded    = this.expandedPaths();
        const childrenMap = this.childrenMap();

        const flatten = (parentPath: string, depth: number): FlatItem[] => {
            const items: FlatItem[] = [];
            for (const node of (childrenMap.get(parentPath) ?? [])) {
                items.push({ kind: 'node', node, depth });
                if (expanded.has(node.path)) {
                    items.push(...flatten(node.path, depth + 1));
                    if (this.pathHasMore.get(node.path)) {
                        items.push({ kind: 'more', path: node.path, depth: depth + 1 });
                    }
                }
            }
            return items;
        };

        const result = flatten(this.rootPath, 0);

        // Root-level "load more" (first page of rootPath)
        if (this.pathHasMore.get(this.rootPath)) {
            result.push({ kind: 'more', path: this.rootPath, depth: 0 });
        }

        return result;
    });

    trackItem(_i: number, item: FlatItem): string {
        return item.kind === 'node' ? item.node.id : `more:${item.path}`;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    constructor() {
        // When currentPath changes (files-panel navigation), expand every ancestor
        // directory and lazily fetch its children if not already loaded.
        effect(() => {
            const fullPath = this.currentPath();
            untracked(() => this.autoExpandPath(fullPath));
        });

        // Full tree reset + reload when a VFS mutation triggers reloadTrigger.
        toObservable(this.state.reloadTrigger).pipe(
            skip(1),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.pathLoaded.clear();
            this.pathHasMore.clear();
            this.pathCursorMap.clear();
            this.childrenMap.set(new Map());
            // Reload root, then re-expand ancestors of current path
            this.fetchPath(this.rootPath);
            untracked(() => this.autoExpandPath(this.currentPath()));
        });

        // Phase 2 VFS live -- reconcile the live-subscription set
        // every time the expanded folder set OR the cached
        // children change. The reconciliation step resolves each
        // expanded path to its node UUID via the parent listing
        // it already loaded; missing UUIDs (folder not yet
        // hydrated in childrenMap) are skipped silently and
        // picked up on the next reconcile after the fetch
        // completes.
        effect(() => {
            const expanded = this.expandedPaths();
            const childrenMap = this.childrenMap();
            const root = this.rootNodeId();

            const parentNodeIds = new Set<string>();
            if (root !== null) {
                parentNodeIds.add(root);
            }
            for (const path of expanded) {
                const uuid = this.resolvePathToUuid(path, childrenMap, root);
                if (uuid !== null) {
                    parentNodeIds.add(uuid);
                }
            }

            untracked(() => {
                this.liveSubs.reconcile(parentNodeIds, event => this.handleLiveEvent(event));
            });
        });
    }

    ngOnInit(): void {
        // Eagerly load root-level children so the tree isn't blank on mount.
        this.fetchPath(this.rootPath);
        // Phase 2 VFS live -- one-shot root stat to discover the
        // root node's UUID; subsequent live-subscription
        // reconciliation includes that id so any direct-child
        // mutation under `/` reaches subscribers.
        this.statRoot();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    indentPx(depth: number): number { return 12 + depth * 16; }

    isCurrentPath(node: VfsNodeDto): boolean {
        return this.currentPath() === node.path ||
               this.currentPath().startsWith(node.path + '/');
    }

    isExpanded(node: VfsNodeDto): boolean {
        return this.expandedPaths().has(node.path);
    }

    isDragOver(node: VfsNodeDto): boolean {
        return this.dragOverNode()?.id === node.id;
    }

    // ── User interactions ──────────────────────────────────────────────────────

    onContextMenu(node: VfsNodeDto, event: MouseEvent): void {
        const nodes = this.state.vfsToolbarNodes();
        if (nodes.length === 0) return;
        const record: Record<string, unknown> = {
            _context:      'node',
            _single:       true,
            _hasClipboard: this.clipboard.hasAny(),
            type:          node.type,
            name:          node.name,
            path:          node.path,
            mimeType:      node.mimeType,
            size:          node.size,
            isSystem:      node.isSystem,
            isHidden:      node.isHidden,
            isContainer:   node.isContainer,
        };
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            record,
            (actionId) => {
                if (actionId === 'upload') {
                    this.state.uploadRequested$.next();
                    return;
                }
                const matched = this.state.vfsToolbarNodes().find(
                    (n) => String(n.meta['action']) === actionId,
                );
                if (matched) this.vfsActions.execute(matched, node);
            },
        );
    }

    navigate(node: VfsNodeDto, event: MouseEvent): void {
        event.stopPropagation();
        if (!node.isContainer) return;
        const path = node.path.startsWith('/') ? node.path : '/' + node.path;
        this.state.navigateTo(path);
        if (!this.expandedPaths().has(node.path)) {
            this.expand(node.path);
        }
    }

    toggleExpand(node: VfsNodeDto, event?: Event): void {
        event?.stopPropagation();
        if (this.expandedPaths().has(node.path)) {
            // Collapse — children stay in childrenMap so re-expand is instant
            this.expandedPaths.update(s => {
                const next = new Set(s);
                next.delete(node.path);
                return next;
            });
        } else {
            this.expand(node.path);
        }
    }

    /** Fetch the next page for a given parent path. */
    loadMoreFor(path: string, event?: Event): void {
        event?.stopPropagation();
        const cursor = this.pathCursorMap.get(path);
        if (!cursor || !this.pathHasMore.get(path)) return;
        this.fetchPath(path, cursor);
    }

    // ── CDK Drag & Drop ────────────────────────────────────────────────────────

    onTreeDropEnter(node: VfsNodeDto): void {
        if (node.type === 'directory') this.dragOverNode.set(node);
    }

    onTreeDropExit(node: VfsNodeDto): void {
        if (this.dragOverNode()?.id === node.id) this.dragOverNode.set(null);
    }

    onTreeDrop(event: CdkDragDrop<VfsNodeDto>, target: VfsNodeDto): void {
        this.dragOverNode.set(null);
        if (target.type !== 'directory') return;
        const source = event.item.data as VfsNodeDto;
        if (source.path === target.path || target.path.startsWith(source.path + '/')) return;
        void this.clipboard.move(source.path, target.path);
    }

    // ── Node label ─────────────────────────────────────────────────────────────

    /** /home/{uuid} dirs resolve to the owning user's identifier. */
    protected nodeLabel(node: VfsNodeDto): string {
        return VfsHomeLabelService.isHomeDir(node)
            ? this.homeLabels.labelFor(node.name)()
            : node.name;
    }

    // ── Auto-expand ────────────────────────────────────────────────────────────

    /**
     * Expand every ancestor directory along fullPath.
     *
     * For each ancestor segment (/home, /home/uuid, …):
     *   - Add its path to expandedPaths immediately.
     *   - If its children haven't been fetched yet, fire fetchPath().
     *
     * Path-based (not node-ID-based) so it works even when the node objects
     * are not yet in memory.
     */
    private autoExpandPath(fullPath: string): void {
        const segments = fullPath.split('/').filter(Boolean);
        let ancestorPath = '';

        for (const segment of segments) {
            ancestorPath += '/' + segment;

            if (!this.pathLoaded.has(ancestorPath)) {
                this.pathLoaded.add(ancestorPath);
                this.fetchPath(ancestorPath);
            }

            this.expandedPaths.update(s => new Set([...s, ancestorPath]));
        }
    }

    // ── Private: expand a path ─────────────────────────────────────────────────

    private expand(path: string): void {
        this.expandedPaths.update(s => new Set([...s, path]));
        if (!this.pathLoaded.has(path)) {
            this.pathLoaded.add(path);
            this.fetchPath(path);
        }
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    /**
     * Fetch one page of children for `path` and merge into `childrenMap`.
     *
     * @param path   Parent directory path to list.
     * @param cursor Optional pagination cursor; when supplied, results are
     *               appended to any existing entries for this path.
     */
    private fetchPath(path: string, cursor?: string): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';
        if (!baseUrl) return;

        // Mark as loaded immediately so concurrent calls don't double-fetch
        this.pathLoaded.add(path);

        const safePath = path.startsWith('/') ? path : '/' + path;
        let url = `${baseUrl}/vfs/directories/list?path=${encodeURIComponent(safePath)}&limit=50`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        // Only show the spinner for the initial root-level fetch
        if (path === this.rootPath && !cursor) this.loading.set(true);

        this.http.get<VfsDirectoryPage>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: r => {
                const all  = Array.isArray(r.member) ? r.member : [];
                const dirs = all
                    .filter(n => n.type === 'directory')
                    .sort((a, b) => a.name.localeCompare(b.name));

                this.childrenMap.update(m => {
                    const next = new Map(m);
                    // Append on cursor continuation; replace on fresh load
                    const prev = cursor ? (next.get(path) ?? []) : [];
                    next.set(path, [...prev, ...dirs]);
                    return next;
                });

                this.pathHasMore.set(path, r.hasMore ?? false);
                this.pathCursorMap.set(path, r.nextCursor ?? null);
                this.homeLabels.register(all);

                if (path === this.rootPath && !cursor) this.loading.set(false);
            },
            error: () => {
                if (path === this.rootPath && !cursor) this.loading.set(false);
            },
        });
    }

    // ── Phase 2 VFS live ──────────────────────────────────────────────────────

    /**
     * One-shot fetch of the root node's UUID via the `vfs/files`
     * stat endpoint. Result populates `rootNodeId`, which the
     * reconciliation effect picks up to subscribe to the root
     * channel. Failures (e.g., root not yet seeded) are silently
     * swallowed; the live-subscription path simply stays empty
     * for the root level.
     */
    private statRoot(): void {
        const manifest = this.store.selectSnapshot(AppConfigState.manifest);
        const baseUrl  = manifest?.apiBase ?? '';
        if (!baseUrl) return;
        const url = `${baseUrl}/vfs/files?path=${encodeURIComponent(this.rootPath)}`;
        this.http.get<VfsNodeDto>(url, {
            headers: { Accept: 'application/ld+json' },
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: node => this.rootNodeId.set(node.id),
            error: () => { /* leave rootNodeId null; reconciliation skips root */ },
        });
    }

    /**
     * Resolve an expanded folder's path string to its node UUID
     * by consulting the cached children listing of its parent
     * path. Root is special-cased -- its UUID lives on the
     * `rootNodeId` signal populated by `statRoot`.
     *
     * Returns null when the path has not yet been hydrated in
     * `childrenMap` (e.g., during an in-flight `fetchPath`); the
     * reconciliation effect re-runs once the fetch lands and
     * picks the id up on the next pass.
     */
    private resolvePathToUuid(path: string, childrenMap: ReadonlyMap<string, ReadonlyArray<VfsNodeDto>>, root: string | null): string | null {
        if (path === this.rootPath || path === '/' || path === '') {
            return root;
        }
        const parentPath = this.parentPathOf(path);
        const siblings = childrenMap.get(parentPath) ?? [];
        const node = siblings.find(n => n.path === path);
        return node?.id ?? null;
    }

    private parentPathOf(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash <= 0) return '/';
        return path.substring(0, lastSlash);
    }

    private handleLiveEvent(event: VfsNodeChangeEvent): void {
        switch (event.type) {
            case 'node.created':
            case 'node.deleted':
            case 'node.moved':
            case 'node.renamed':
                this.refetchParentByUuid(event.parentNodeId);
                if (event.previousParentNodeId !== null) {
                    this.refetchParentByUuid(event.previousParentNodeId);
                }
                this.flashNode(event.nodeId);
                break;
            case 'node.metadata_changed':
            case 'node.content_updated':
                this.refetchSingleNode(event.nodeId);
                this.flashNode(event.nodeId);
                break;
        }
    }

    private refetchParentByUuid(parentNodeId: string): void {
        const parentPath = this.findPathByUuid(parentNodeId);
        if (parentPath === null) {
            return;
        }
        // Force a full re-listing of the parent. `fetchPath` with
        // no cursor replaces the cached children entry, which
        // covers create / delete / move / rename uniformly.
        this.pathLoaded.delete(parentPath);
        this.fetchPath(parentPath);
    }

    private findPathByUuid(uuid: string): string | null {
        if (uuid === this.rootNodeId()) {
            return this.rootPath;
        }
        for (const children of this.childrenMap().values()) {
            for (const child of children) {
                if (child.id === uuid) {
                    return child.path;
                }
            }
        }
        return null;
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
                this.childrenMap.update(map => {
                    for (const [parentPath, children] of map) {
                        const idx = children.findIndex(c => c.id === nodeId);
                        if (idx === -1) continue;
                        const newChildren = [...children];
                        newChildren[idx] = updated;
                        const next = new Map(map);
                        next.set(parentPath, newChildren);
                        return next;
                    }
                    return map;
                });
            },
            error: () => {
                // 404 here is benign -- a deletion event likely
                // follows / preceded this refetch; the structural
                // event will remove the row from the listing.
                // Other errors are silent: subscribers tolerate
                // brief staleness.
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
}
