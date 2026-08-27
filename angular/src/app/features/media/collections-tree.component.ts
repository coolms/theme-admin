import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    input,
    OnInit,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { catchError, EMPTY, filter, of, switchMap } from 'rxjs';
import { MediaPageStateService } from './media-page-state.service';
import { MediaService } from './media.service';
import { ApiService } from '../../api/api.service';
import {
    CmsItemInteractionsDirective,
    ContextMenuService,
    DeleteNodeDialogComponent,
    DeleteNodeDialogResult,
    ToastService,
    type CmsSelectionChange,
} from '@coolms/ui-angular';
import { MEDIA_ROOT_MENU_ITEMS } from './media-root-menu';
import { CollectionPermissionsComponent } from './collection-permissions.component';
import { CollectionNode } from './media.types';

/** A single row in the flattened, visible collections tree. */
interface FlatCollectionItem {
    readonly node:      CollectionNode;
    readonly paddingPx: number;
}

/**
 * Left-panel collections tree for the Media Library.
 *
 * Reads currentDir and collections from MediaPageStateService.
 * Handles all collection CRUD (create/rename/delete) directly by injecting
 * ApiService and MediaService, then updating service state.
 *
 * Registered as 'CollectionsTree' in ComponentRegistry.
 */
@Component({
    selector: 'app-collections-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsItemInteractionsDirective],
    template: `
        <div class="media-sidebar">

            <!-- Header (hidden when the accordion wrapper provides its own chrome) -->
            @if (!embedded()) {
                <div class="sidebar-header">
                    <span class="sidebar-header-label">Collections</span>
                    <button class="cms-btn cms-btn-ghost cms-btn-sm"
                            title="New collection"
                            (click)="showNewColl.set(!showNewColl())">
                        <i class="bi bi-plus-lg"></i>
                    </button>
                </div>
            }

            <!-- New collection form -->
            @if (showNewColl()) {
                <div class="p-2 border-bottom">
                    <div class="d-flex gap-1">
                        <input type="text" class="cms-input"
                               placeholder="Collection name…"
                               [value]="newCollName()"
                               (input)="newCollName.set($any($event.target).value)"
                               (keydown.enter)="createCollection()"
                               (keydown.escape)="showNewColl.set(false)"
                               autofocus />
                        <button class="cms-btn cms-btn-primary cms-btn-sm"
                                (click)="createCollection()">
                            <i class="bi bi-check-lg"></i>
                        </button>
                    </div>
                </div>
            }

            <!-- All media root — only shown in standalone mode (the
                 accordion wrapper provides its own root affordance). -->
            @if (!embedded()) {
                <div class="sidebar-item"
                     style="--item-indent: 8px"
                     cmsItemInteractions
                     [cmsItem]="rootNode"
                     [selectionMode]="'single'"
                     [dblclickDelay]="0"
                     [class.active]="state.currentDir() === '/media'"
                     (selectionChanged)="onRootSelectionChanged()"
                     (contextMenuRequested)="onRootContextMenu($event.event)">
                    <i class="bi bi-folder-fill me-1" style="color:var(--cms-accent)"></i> All media
                </div>
            }

            <!-- Flat collection list — depth pre-computed in flatItems() signal.
                 No recursive ng-template; no ngStyle binding; no CSS padding-left
                 on .sidebar-item class — inline style wins with 100% reliability. -->
            @for (item of flatItems(); track item.node.path) {
                <div class="sidebar-item"
                     [style.--item-indent]="item.paddingPx + 'px'"
                     cmsItemInteractions
                     [cmsItem]="item.node"
                     [selectionMode]="'single'"
                     [dblclickDelay]="0"
                     [class.active]="state.currentDir() === item.node.path"
                     (selectionChanged)="onCollectionSelectionChanged($event)"
                     (contextMenuRequested)="onCollectionContextMenu($event.event, $event.item)">

                    @if (item.node.children.length > 0) {
                        <button type="button" class="sidebar-expand-btn"
                                (click)="$event.stopPropagation(); toggleExpand(item.node.path)">
                            {{ expandedPaths().has(item.node.path) ? '▾' : '▸' }}
                        </button>
                    } @else {
                        <span style="width:16px;display:inline-block"></span>
                    }

                    <i class="bi bi-folder-fill" style="color:var(--cms-accent);font-size:.8125rem"></i>

                    @if (renameCollPath() === item.node.path) {
                        <input type="text"
                               class="cms-input rename-input"
                               [value]="renameValue()"
                               (input)="renameValue.set($any($event.target).value)"
                               (keydown.enter)="commitRename(item.node)"
                               (keydown.escape)="renameCollPath.set(null)"
                               (click)="$event.stopPropagation()"
                               autofocus />
                    } @else {
                        <span class="text-truncate">{{ item.node.name }}</span>
                    }
                </div>
            }

        </div>
    `,
    styles: [`
        :host { display: block; flex: 1; min-height: 0; overflow-y: auto; }
        .media-sidebar { display: flex; flex-direction: column; }
        .sidebar-header {
            padding: 6px 8px; border-bottom: 1px solid var(--cms-border);
            display: flex; align-items: center; gap: 4px;
            position: sticky; top: 0; z-index: 1;
            background: var(--cms-sidebar-bg, #fff);
        }
        .sidebar-header-label {
            font-size: .75rem; font-weight: 600; color: var(--cms-text-secondary);
            text-transform: uppercase; letter-spacing: .06em; flex: 1;
        }
        .sidebar-item {
            /* Indent is driven by --item-indent CSS custom property, set per-row
               via [style.--item-indent] binding or a static style="--item-indent:…".
               Custom properties bypass Angular Ivy's style reconciler entirely and
               are immune to merge-order conflicts with class-level padding rules. */
            padding-left: var(--item-indent, 8px);
            padding-top: 6px;
            padding-right: 8px;
            padding-bottom: 6px;
            cursor: pointer; font-size: .8125rem;
            display: flex; align-items: center; gap: 6px;
            user-select: none; white-space: nowrap; overflow: hidden;
        }
        .sidebar-item:hover { background: var(--cms-border-light); }
        .sidebar-item.active {
            background: var(--cms-accent-light); color: var(--cms-accent-text);
            font-weight: 600; box-shadow: inset 2px 0 0 var(--cms-accent);
        }
        .sidebar-expand-btn {
            background: none; border: none; padding: 0;
            width: 16px; font-size: .75rem; line-height: 1;
            cursor: pointer; flex-shrink: 0; color: var(--cms-text-muted);
            &:hover { color: var(--cms-text); }
        }
        .rename-input { height: 22px; font-size: .8rem; padding: 0 4px; flex: 1; min-width: 0; }
    `],
})
export class CollectionsTreeComponent implements OnInit {
    readonly state = inject(MediaPageStateService);

    private readonly svc         = inject(MediaService);
    private readonly api         = inject(ApiService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly dialog      = inject(Dialog);
    private readonly toast       = inject(ToastService);
    private readonly destroyRef  = inject(DestroyRef);

    /**
     * When true, the tree is rendered inside the {@link MediaSpaceAccordionComponent}
     * accordion shell, which provides its own header and root entry.
     * Default false keeps the standalone behaviour for callers that
     * import the tree directly (legacy code paths, picker).
     */
    readonly embedded = input<boolean>(false);

    // Local UI state
    readonly expandedPaths  = signal<Set<string>>(new Set(['/media']));
    readonly showNewColl    = signal(false);
    readonly newCollName    = signal('');
    readonly renameCollPath = signal<string | null>(null);
    readonly renameValue    = signal('');

    /** Sentinel node passed to the directive for the "All media" root. */
    protected readonly rootNode: CollectionNode = { path: '/media', name: 'All media', depth: 0, children: [] };

    protected onRootSelectionChanged(): void {
        this.setDir('/media');
    }

    protected onCollectionSelectionChanged(event: CmsSelectionChange<CollectionNode>): void {
        const node = event.selection[0];
        if (!node) return;
        if (this.renameCollPath() === node.path) return;
        this.setDir(node.path);
    }

    /**
     * Depth-first flattened view of the collections tree.
     *
     * Padding formula: 8 + visualDepth × 16.
     *   depth=1 → 24px  (collection items)
     *   depth=2 → 40px  (sub-collections)
     *
     * "All media" root uses --item-indent: 8px with NO leading spacer, so its
     * folder icon sits at 8px.  Collection items at 24px have a 16px expand-btn
     * before the folder icon (icon at 40px).  The 16px gap between the root icon
     * (8px) and the collection container start (24px) gives a clear visual indent.
     */
    readonly flatItems = computed((): FlatCollectionItem[] => {
        const result:   FlatCollectionItem[] = [];
        const expanded = this.expandedPaths();

        const flatten = (nodes: CollectionNode[], visualDepth: number): void => {
            for (const node of nodes) {
                result.push({ node, paddingPx: 8 + visualDepth * 16 });
                if (expanded.has(node.path) && node.children.length > 0) {
                    flatten(node.children, visualDepth + 1);
                }
            }
        };

        flatten(this.state.collections(), 1);
        return result;
    });

    ngOnInit(): void {
        // Page signals "show new collection form"
        this.state.newCollectionRequested$.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.newCollName.set('');
            this.showNewColl.set(true);
        });

        // Page signals "start renaming this path"
        this.state.renameCollectionRequested$.pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(path => {
            this.renameCollPath.set(path);
            this.renameValue.set(path.split('/').at(-1) ?? path);
        });
    }

    setDir(path: string): void {
        this.state.currentDir.set(path);
    }

    toggleExpand(path: string): void {
        this.expandedPaths.update(set => {
            const next = new Set(set);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }

    createCollection(): void {
        const name = this.newCollName().trim();
        if (!name) return;
        const path = this.state.currentDir() + '/' + name;
        this.svc.createCollection(path).pipe(
            catchError((err) => {
                const detail: string = err?.error?.detail
                    ?? err?.error?.['hydra:description']
                    ?? err?.message
                    ?? 'Failed to create collection.';
                this.toast.error(detail);
                return EMPTY;
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            this.showNewColl.set(false);
            this.newCollName.set('');
            this.reloadCollections();
            this.setDir(path);
        });
    }

    onRootContextMenu(event: MouseEvent): void {
        const root: CollectionNode = { path: '/media', name: 'All media', depth: 0, children: [] };
        this.contextMenu.open(
            event,
            [...MEDIA_ROOT_MENU_ITEMS],
            (action) => this.onCollectionAction({ action, collection: root }),
        );
    }

    onCollectionContextMenu(event: MouseEvent, collection: CollectionNode): void {
        const nodes = this.state.toolbarNodes();
        this.contextMenu.openFromNodes(
            event,
            nodes,
            { _context: 'collection', _single: true, _surface: 'context' },
            (action) => this.onCollectionAction({ action, collection }),
        );
    }

    onCollectionAction({ action, collection }: { action: string; collection: CollectionNode }): void {
        switch (action) {
            case 'new-sub':
                this.setDir(collection.path);
                this.expandedPaths.update(s => { const n = new Set(s); n.add(collection.path); return n; });
                this.newCollName.set('');
                this.showNewColl.set(true);
                break;
            case 'upload':
                this.state.uploadRequested$.next();
                break;
            case 'permissions':
            case 'col-perms':
                this.openCollectionPermissions(collection.path);
                break;
            case 'col-properties':
                // Open the collection Properties panel (localized title + description).
                this.state.activeAsset.set(null);
                this.state.activeCollection.set({ path: collection.path, name: collection.name });
                break;
            case 'rename':
                this.renameCollPath.set(collection.path);
                this.renameValue.set(collection.name);
                break;
            case 'delete':
            case 'delete-col':
                this.deleteCollection(collection);
                break;
        }
    }

    openCollectionPermissions(path: string): void {
        const node = this.state.toolbarNodes().find(n => n.meta['action'] === 'col-perms');
        const icon = node ? String(node.meta['icon'] ?? 'lock') : 'lock';
        this.dialog.open(CollectionPermissionsComponent, { data: { path, icon } });
    }

    deleteCollection(collection: CollectionNode): void {
        const ref = this.dialog.open<DeleteNodeDialogResult | null>(DeleteNodeDialogComponent, {
            data: {
                name:          collection.name,
                message:       'This collection will be permanently deleted.',
                showRecursive: true,
                recursiveLabel: 'Delete all files inside this collection',
            },
        });
        ref.closed.pipe(
            filter((result): result is DeleteNodeDialogResult => result !== null && result !== undefined),
            switchMap(result => this.svc.deleteCollection(collection.path, result.recursive).pipe(
                catchError((err) => {
                    const detail: string = err?.error?.detail
                        ?? err?.error?.['hydra:description']
                        ?? err?.message
                        ?? 'Failed to delete collection.';
                    this.toast.error(detail);
                    return EMPTY;
                }),
            )),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            if (this.state.currentDir() === collection.path ||
                this.state.currentDir().startsWith(collection.path + '/')) {
                this.setDir('/media');
            }
            this.reloadCollections();
        });
    }

    commitRename(collection: CollectionNode): void {
        const newName = this.renameValue().trim();
        this.renameCollPath.set(null);
        if (!newName || newName === collection.name) return;
        const target = collection.path.replace(/\/[^/]+$/, '/' + newName);
        this.svc.moveNode(collection.path, target).pipe(
            catchError((err) => {
                const detail: string = err?.error?.detail
                    ?? err?.error?.['hydra:description']
                    ?? err?.message
                    ?? 'Failed to rename collection.';
                this.toast.error(detail);
                return EMPTY;
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
            // Keep the explorer inside the renamed subtree: re-point the
            // current dir onto the new path (the backend re-pathed every
            // descendant), then refresh the tree.
            const current = this.state.currentDir();
            if (current === collection.path || current.startsWith(collection.path + '/')) {
                this.setDir(target + current.slice(collection.path.length));
            }
            this.reloadCollections();
        });
    }

    private reloadCollections(): void {
        this.svc.listCollections('/media', 5).pipe(
            catchError((err) => {
                const detail: string = err?.error?.detail
                    ?? err?.error?.['hydra:description']
                    ?? err?.message
                    ?? 'Failed to load collections.';
                this.toast.error(detail);
                return of([]);
            }),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(flat => this.state.collections.set(this.buildTree(flat)));
    }

    private buildTree(flat: { path: string; name: string; depth: number }[]): CollectionNode[] {
        const root: CollectionNode[] = [];
        const byPath = new Map<string, CollectionNode>();
        for (const item of flat) {
            const node: CollectionNode = { ...item, children: [] };
            byPath.set(item.path, node);
            const parentPath = item.path.split('/').slice(0, -1).join('/');
            const parent = byPath.get(parentPath);
            if (parent) parent.children.push(node);
            else root.push(node);
        }
        return root;
    }

}
