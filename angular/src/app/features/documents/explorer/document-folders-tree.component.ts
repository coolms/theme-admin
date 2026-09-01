import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';

import { ApiService, NodeDto } from '../../../api/api.service';
import { AuthState } from '@coolms/core-angular';
import { ContextMenuService } from '@coolms/ui-angular';
import { DocumentPageStateService } from './document-page-state.service';
import { transformVfsToTree, type VfsTreeNode } from './vfs-tree.helpers';

/**
 * F.14c-3 — VFS-tree folders sidebar. Replaces the F.13b
 * `DocumentFoldersService`-driven flat list with a real lazy-expand
 * tree backed by `ApiService.listDirectory()`.
 *
 * Two top-level roots:
 *
 *   SHARED        ->  /docs
 *   MY DOCUMENTS  ->  /home/{currentUser.id}/docs   (may 404 if the
 *                   user has never had a personal documents folder
 *                   provisioned — surfaces the inline "No documents
 *                   folder yet." message rather than a broken row)
 *
 * Click a row -> the page's main panel switches to the folder-content
 * view for that path. Click the chevron -> lazily fetches children
 * via `listDirectory()` and renders them indented one level deeper.
 *
 * The `.templates/` discriminator is filtered out by
 * `transformVfsToTree`; templates inside surface in the
 * folder-content view, not the tree. Files are also filtered out for
 * the same reason -- the tree shows directories only.
 */
@Component({
    selector: 'cms-document-folders-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
    template: `
        <div class="cms-document-folders-tree">
            @for (root of roots(); track root.path) {
                <section class="cms-document-folders-tree__section">
                    <!-- The root's own title is a HEADING for a forest of roots.
                         Embedded in the space accordion there is exactly one
                         root — the space that was just clicked — so the button
                         restated the selection directly under it and selecting
                         it did what selecting the space already does.
                         Standalone (the forest) it still earns its place. -->
                    @if (!embedded()) {
                        <button
                            type="button"
                            class="cms-document-folders-tree__title"
                            [class.cms-document-folders-tree__title--active]="isActive(root.path)"
                            (click)="select(root.path)"
                            (contextmenu)="onContextMenu($event, root.path)"
                        >{{ root.title }}</button>
                    }

                    @if (rootError(root.path); as err) {
                        <p class="cms-document-folders-tree__empty">{{ err }}</p>
                    } @else {
                        @if (rootNode(root.path)?.children; as children) {
                            @for (child of children; track child.path) {
                                <ng-container
                                    *ngTemplateOutlet="treeNode; context: { node: child, depth: 0, rootKey: root.path }"
                                />
                            }
                            @if (children.length === 0) {
                                <p class="cms-document-folders-tree__empty">No subfolders.</p>
                            }
                        }
                    }
                </section>
            }
        </div>

        <ng-template #treeNode let-node="node" let-depth="depth" let-rootKey="rootKey">
            @if (node) {
                <div class="cms-document-folders-tree__row"
                     [style.paddingLeft.px]="depth * 14 + 4"
                     [class.cms-document-folders-tree__row--active]="isActive(node.path)">
                    <button
                        type="button"
                        class="cms-document-folders-tree__chevron"
                        [class.cms-document-folders-tree__chevron--placeholder]="!node.hasChildren"
                        [attr.aria-expanded]="isExpanded(node.path)"
                        (click)="toggle(node, $event)"
                    >
                        @if (node.hasChildren) {
                            <i class="bi" [class.bi-chevron-right]="!isExpanded(node.path)"
                               [class.bi-chevron-down]="isExpanded(node.path)"></i>
                        }
                    </button>
                    <button
                        type="button"
                        class="cms-document-folders-tree__node"
                        (click)="select(node.path)"
                        (contextmenu)="onContextMenu($event, node.path)"
                    >
                        <i class="bi" [class.bi-folder]="!isExpanded(node.path)"
                           [class.bi-folder2-open]="isExpanded(node.path)"></i>
                        <span>{{ node.name }}</span>
                    </button>
                </div>

                @if (isExpanded(node.path) && node.children) {
                    @for (child of node.children; track child.path) {
                        <ng-container
                            *ngTemplateOutlet="treeNode; context: { node: child, depth: depth + 1, rootKey }"
                        />
                    }
                    @if (node.children.length === 0) {
                        <p class="cms-document-folders-tree__empty"
                           [style.paddingLeft.px]="(depth + 1) * 14 + 4">
                            No subfolders.
                        </p>
                    }
                }
            }
        </ng-template>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
            overflow: auto;
        }
        .cms-document-folders-tree {
            padding: var(--cms-panel-padding);
        }
        .cms-document-folders-tree__section + .cms-document-folders-tree__section {
            margin-top: 1.25rem;
        }
        .cms-document-folders-tree__title {
            display: block;
            width: 100%;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--cms-text-muted);
            padding: 4px 8px;
            margin: 0 0 4px 0;
            text-align: left;
            background: transparent;
            border: 0;
            border-radius: var(--cms-radius-sm);
            cursor: pointer;
            font-family: inherit;
            transition: background 0.1s, color 0.1s;
        }
        .cms-document-folders-tree__title:hover {
            background: var(--cms-border-light);
            color: var(--cms-text-secondary);
        }
        .cms-document-folders-tree__title--active {
            color: var(--cms-text);
            background: var(--cms-border-light);
        }
        .cms-document-folders-tree__row {
            display: flex;
            align-items: center;
            gap: 2px;
            border-radius: var(--cms-radius-sm);
        }
        .cms-document-folders-tree__row:hover,
        .cms-document-folders-tree__row--active {
            background: var(--cms-border-light);
        }
        .cms-document-folders-tree__row--active .cms-document-folders-tree__node {
            font-weight: 500;
        }
        .cms-document-folders-tree__chevron {
            border: 0;
            background: transparent;
            cursor: pointer;
            color: var(--cms-text-muted);
            width: 18px;
            height: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            padding: 0;
        }
        .cms-document-folders-tree__chevron--placeholder {
            cursor: default;
        }
        .cms-document-folders-tree__node {
            display: flex;
            align-items: center;
            gap: 6px;
            border: 0;
            background: transparent;
            color: inherit;
            text-align: left;
            cursor: pointer;
            font: inherit;
            padding: 4px 4px;
            flex: 1;
            min-width: 0;
        }
        .cms-document-folders-tree__node span {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .cms-document-folders-tree__empty {
            padding: 4px 8px;
            color: var(--cms-text-muted);
            font-size: 0.85rem;
            font-style: italic;
            margin: 0;
        }
    `],
})
export class DocumentFoldersTreeComponent implements OnInit {
    private readonly api = inject(ApiService);
    private readonly store = inject(Store);
    private readonly state = inject(DocumentPageStateService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * H4 — when rendered inside {@link DocumentSpaceAccordionComponent}
     * the tree must show ONLY the active space's root rather than the
     * legacy Shared + My Documents pair. The accordion drives selection
     * by setting `rootPath` from the active space; the tree mirrors that
     * single subtree. Default false keeps the standalone behaviour for
     * tests or future direct embedders.
     */
    readonly embedded = input<boolean>(false);

    /**
     * H4 — sole root path when `embedded` is true. The accordion sets
     * this when the user picks a different space. Ignored when
     * `embedded` is false.
     */
    readonly rootPath = input<string>('');

    /**
     * Each root is a self-contained subtree. The `path` doubles as the
     * stable key in `nodeByPath` so reads against the store don't have
     * to walk a forest. In embedded mode the list collapses to the
     * single accordion-driven root path.
     */
    protected readonly roots = computed(() => {
        if (this.embedded()) {
            const p = this.rootPath();
            if (!p) return [];
            const segments = p.split('/').filter(Boolean);
            const last = segments[segments.length - 1] ?? p;
            return [{ title: last, path: p }];
        }
        const u = this.store.selectSnapshot(AuthState.currentUser);
        const list: { title: string; path: string }[] = [
            { title: 'Shared', path: '/docs' },
        ];
        if (u?.id) {
            list.push({ title: 'My Documents', path: `/home/${u.id}/docs` });
        }
        return list;
    });

    /**
     * Path-keyed map of every node we've materialised so far. Roots
     * live here too — their `name` is the trailing path segment, but
     * the section header above prints the human-readable title from
     * `roots`.
     */
    private readonly nodes = signal<ReadonlyMap<string, VfsTreeNode>>(new Map());

    /**
     * Per-root error message, keyed by the root path. `null` means the
     * root is healthy (or not yet loaded). Errors stay on the root
     * level rather than per-child to keep the tree from filling up
     * with noisy red rows when, e.g., the personal zone hasn't been
     * provisioned for the current user.
     */
    private readonly rootErrors = signal<ReadonlyMap<string, string>>(new Map());

    constructor() {
        // H4 — reload children whenever the embedded root path swaps
        // (user picked a different space). Ignored in standalone mode
        // (roots are static there).
        effect(() => {
            if (!this.embedded()) return;
            const path = this.rootPath();
            // — also re-run when a folder is created. The root PATH
            // is unchanged by a new child appearing under it, so without
            // this the tree kept showing the pre-create listing while the
            // folder chips already had the new one.
            this.state.folderVersion();
            if (!path) return;
            untracked(() => this.loadDirectory(path));
        });
    }

    ngOnInit(): void {
        for (const root of this.roots()) {
            this.loadDirectory(root.path);
        }
    }

    protected isActive(path: string): boolean {
        return this.state.currentPath() === path;
    }

    protected isExpanded(path: string): boolean {
        return this.state.expandedPaths().has(path);
    }

    protected rootNode(path: string): VfsTreeNode | null {
        return this.nodes().get(path) ?? null;
    }

    protected rootError(path: string): string | null {
        return this.rootErrors().get(path) ?? null;
    }

    protected select(path: string): void {
        this.state.selectFolder(path);
    }

    /**
     * E6 — folder right-click. Per E5 lesson, the tree uses a bespoke
     * `(contextmenu)` binding rather than `CmsItemInteractionsDirective`
     * because the tree's "selection" is navigation (`currentPath`),
     * not a multi-select list.
     */
    protected onContextMenu(event: MouseEvent, path: string): void {
        event.preventDefault();
        event.stopPropagation();
        const nodes = this.state.toolbarNodes();
        if (nodes.length === 0) return;
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            {
                _kind: 'folder',
                _surface: 'context',
                path,
            },
            (action) => {
                if (action === 'upload-here') {
                    this.state.uploadToFolderRequested$.next(path);
                }
                // — creates UNDER the right-clicked folder, which is
                // why it carries the path rather than reading currentPath.
                if (action === 'new-folder-here') {
                    this.state.newFolderInRequested$.next(path);
                }
            },
        );
    }

    protected toggle(node: VfsTreeNode, event: Event): void {
        event.stopPropagation();
        if (!node.hasChildren) {
            return;
        }
        const expanded = this.isExpanded(node.path);
        if (expanded) {
            this.state.setExpanded(node.path, false);
            return;
        }
        this.state.setExpanded(node.path, true);
        if (node.children === null) {
            // First expand: lazy-load children. Subsequent expands
            // re-use the cached payload.
            this.loadDirectory(node.path);
        }
    }

    /**
     * Fetch children for a directory and merge them into the local
     * tree. The root case is special: the root row itself has no
     * pre-existing entry in `nodes`, so we synthesise one with the
     * children attached and the path-segment name.
     */
    private loadDirectory(path: string): void {
        this.api
            .listDirectory(path)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (children: NodeDto[]) => {
                    const childTree = transformVfsToTree(children);
                    const next = new Map(this.nodes());
                    const existing = next.get(path);
                    const updated: VfsTreeNode = {
                        path,
                        name: existing?.name ?? path.split('/').pop() ?? path,
                        hasChildren: existing?.hasChildren ?? true,
                        children: childTree,
                    };
                    next.set(path, updated);
                    // Ensure each child is also present in the map so
                    // future expands hit the same shared signal.
                    for (const c of childTree) {
                        if (!next.has(c.path)) {
                            next.set(c.path, c);
                        }
                    }
                    this.nodes.set(next);

                    // Roots auto-expand on first load so the user sees
                    // their first level of content without a click.
                    const rootPaths = this.roots().map((r) => r.path);
                    if (rootPaths.includes(path) && !this.state.expandedPaths().has(path)) {
                        this.state.setExpanded(path, true);
                    }

                    // Clear any stale error for this path.
                    if (this.rootErrors().has(path)) {
                        const errs = new Map(this.rootErrors());
                        errs.delete(path);
                        this.rootErrors.set(errs);
                    }
                },
                error: () => {
                    const rootPaths = this.roots().map((r) => r.path);
                    if (rootPaths.includes(path)) {
                        const errs = new Map(this.rootErrors());
                        errs.set(path, 'No documents folder yet.');
                        this.rootErrors.set(errs);
                    }
                },
            });
    }
}
