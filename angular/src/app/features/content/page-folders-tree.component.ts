import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    effect,
    inject,
    input,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ContextMenuService } from '@coolms/ui-angular';
import { PageService } from './page.service';
import { PageSpaceStateService } from './page-space-state.service';
import { PageDto } from './page.types';

/** One folder in the tree, with its lazily-loaded children. */
interface FolderNode {
    readonly id: string;
    readonly path: string;
    readonly name: string;
    children: FolderNode[] | null;   // null = not loaded yet
    expanded: boolean;
    /**
     * A children request is in flight (#1714).
     *
     * Deliberately NOT rendered. It exists only to stop a second request when
     * the user expands a folder whose prefetch has not landed yet — the tree
     * shows nothing at all until the answer is known, which is the point.
     */
    pending: boolean;
}

/**
 * Folder tree for the active page space (#1706).
 *
 * Projected into the space accordion, so it renders under the space you picked
 * — the sections (`blog`, `docs`, `news`) that used to be rows in the grid.
 * Moving them here is what let the listing become pages-only: a folder is a
 * PLACE, and a place belongs in the navigator, not interleaved with the things
 * it contains.
 *
 * Children load on expand rather than up front. A site's page tree is the site
 * structure — potentially every section and sub-section — and eager loading
 * would fetch the whole thing to render a strip a few entries tall.
 *
 * Selection writes the SHARED cursor, which the main pane reacts to; this
 * component never talks to the listing directly, because ExplorerLayout builds
 * them as sibling slots that cannot see each other.
 */
@Component({
    selector: 'app-page-folders-tree',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // `NgTemplateOutlet` is what makes the recursive `branch` template work.
    // Without it the build still passes and the tree renders NOTHING —
    // the outlet is just an unknown attribute on an `<ng-container>`.
    imports: [NgTemplateOutlet],
    template: `
        <div class="page-folders">
            @for (node of roots(); track node.id) {
                <ng-container
                    *ngTemplateOutlet="branch; context: { node: node, depth: 0 }" />
            }
            @if (loadingRoots()) {
                <p class="page-folders__note">Loading…</p>
            } @else if (roots().length === 0) {
                <p class="page-folders__note">No sections.</p>
            }
        </div>

        <ng-template #branch let-node="node" let-depth="depth">
            <div class="page-folders__row"
                 [class.page-folders__row--active]="isActive(node)"
                 [style.padding-left.px]="8 + depth * 12"
                 (contextmenu)="onFolderContextMenu($event, node)">
                <!-- The twisty stays in the DOM when the node turns out to be a
                     leaf, hidden rather than removed, so names do not shift
                     left by 18px the moment a section is opened. -->
                <button type="button"
                        class="page-folders__twisty"
                        [class.page-folders__twisty--open]="node.expanded"
                        [class.page-folders__twisty--leaf]="isKnownLeaf(node)"
                        [disabled]="isKnownLeaf(node)"
                        [attr.aria-label]="node.expanded ? 'Collapse' : 'Expand'"
                        (click)="toggle(node)">
                    <i class="bi bi-chevron-right"></i>
                </button>
                <button type="button" class="page-folders__name" (click)="select(node)">
                    <i class="bi" [class.bi-folder-fill]="node.expanded"
                       [class.bi-folder]="!node.expanded"></i>
                    <span class="page-folders__label">{{ node.name }}</span>
                </button>
            </div>

            <!-- NOTHING transient renders here (#1714). No "No subfolders."
                 note, and no "Loading…" either: both flashed for the length of
                 one request every time a section was opened, which is the
                 whole complaint. The tree prefetches one level ahead, so by
                 the time a folder can be clicked its children are usually
                 already known and this expands instantly; when they are not,
                 the row simply stays as it was until the answer arrives. -->
            @if (node.expanded) {
                @for (child of node.children ?? []; track child.id) {
                    <ng-container
                        *ngTemplateOutlet="branch; context: { node: child, depth: depth + 1 }" />
                }
            }
        </ng-template>
    `,
    styles: [`
        :host { display: block; }
        .page-folders { padding: 4px 0; }
        .page-folders__row {
            display: flex;
            align-items: center;
            gap: 2px;
            border-radius: var(--cms-radius-sm);
        }
        .page-folders__row:hover { background: var(--cms-border-light); }
        .page-folders__row--active { background: var(--cms-accent-light); }
        .page-folders__twisty {
            flex: 0 0 auto;
            width: 18px;
            height: 22px;
            padding: 0;
            border: 0;
            background: transparent;
            color: var(--cms-text-muted);
            cursor: pointer;
            font-size: .7rem;
            transition: transform .12s;
        }
        .page-folders__twisty--open { transform: rotate(90deg); }
        /* Known leaf: keeps its width so the row stays aligned with its
           siblings, but shows and clicks nothing (#1712). */
        .page-folders__twisty--leaf { visibility: hidden; pointer-events: none; }
        .page-folders__name {
            flex: 1;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 6px 3px 0;
            border: 0;
            background: transparent;
            color: var(--cms-text);
            font: inherit;
            font-size: .8125rem;
            text-align: left;
            cursor: pointer;
        }
        .page-folders__name .bi { color: var(--cms-accent); font-size: .8rem; }
        .page-folders__label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .page-folders__note {
            margin: 2px 0;
            padding: 2px 8px;
            font-size: .75rem;
            color: var(--cms-text-muted);
        }
    `],
})
export class PageFoldersTreeComponent {
    /**
     * VFS root of the space whose folders these are. Re-reading it reloads the
     * tree, so switching space swaps the whole strip.
     */
    readonly rootPath = input<string>('');

    private readonly pageSvc = inject(PageService);
    private readonly state = inject(PageSpaceStateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly contextMenu = inject(ContextMenuService);

    protected readonly roots = signal<FolderNode[]>([]);
    protected readonly loadingRoots = signal(false);

    constructor() {
        effect(() => {
            const root = this.rootPath();
            untracked(() => this.loadRoots(root));
        });
    }

    /** The folder currently on screen — highlighted, not re-navigated. */
    protected isActive(node: FolderNode): boolean {
        return this.state.folderId() === node.id;
    }

    protected select(node: FolderNode): void {
        this.state.enterFolder(node.id, node.path);
        // Opening it too: picking a folder almost always means "show me what is
        // under here", and making the user hit the twisty separately is a
        // second click for a thing they already asked for.
        if (!node.expanded) {
            this.toggle(node);
        }
    }

    /**
     * Right-click a section (#1712) — the left panel had no menu at all.
     *
     * Does NOT navigate. The first version selected the folder before opening
     * the menu, on the theory that the entries act on the folder cursor — but
     * `openCreateDialog` scopes to the SPACE and never reads the cursor, so
     * the selection bought nothing and right-clicking a section silently
     * loaded its contents. A context menu is a question, not a command:
     * looking at a folder's options should not move you into it. `Open` is
     * there for when that IS what you wanted.
     */
    protected onFolderContextMenu(event: MouseEvent, node: FolderNode): void {
        const nodes = this.state.toolbarNodes();
        if (0 === nodes.length) {
            return;
        }
        event.preventDefault();
        this.contextMenu.openFromNodes(
            event,
            [...nodes],
            { _kind: 'folder', _selected: false, _surface: 'context' },
            action => {
                if ('open-folder' === action) {
                    this.select(node);

                    return;
                }
                // #1717 — section properties act on the folder that was
                // right-clicked, NOT on the cursor, so the target travels with
                // the action. Everything else is cursor/space-scoped and goes
                // through the plain channel.
                if ('section-properties' === action) {
                    this.state.sectionActionRequested$.next({ action, path: node.path, label: node.name });

                    return;
                }
                this.state.actionRequested$.next(action);
            },
        );
    }

    /**
     * True once we KNOW the folder has nothing under it (#1712).
     *
     * The tree is lazy, so `children: null` means "not asked yet", not
     * "empty" — the twisty has to stay until the first expand answers the
     * question. After that an empty array is a definite answer and the
     * control retires rather than staying as a chevron that does nothing.
     */
    protected isKnownLeaf(node: FolderNode): boolean {
        return null !== node.children && 0 === node.children.length;
    }

    protected toggle(node: FolderNode): void {
        node.expanded = !node.expanded;
        // `pending` guards the case where the prefetch is still in flight —
        // without it, expanding early would fire the same request twice.
        if (node.expanded && null === node.children && !node.pending) {
            this.loadChildren(node);
        }
        // The nodes are plain objects inside a signal; re-emit so OnPush sees it.
        this.roots.update(list => [...list]);
    }

    private loadRoots(rootPath: string): void {
        if ('' === rootPath) {
            this.roots.set([]);

            return;
        }
        this.loadingRoots.set(true);
        this.pageSvc.listPages({ space: this.state.spaceKey() }).pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError(() => of([] as PageDto[])),
        ).subscribe(items => {
            this.loadingRoots.set(false);
            const nodes = this.toNodes(items);
            this.roots.set(nodes);
            this.prefetch(nodes);
        });
    }

    /**
     * @param lookAhead resolve the grandchildren too once this lands. FALSE
     *        when the call IS the look-ahead — otherwise each prefetch would
     *        trigger the next and the "one level" walk would swallow the whole
     *        tree on mount.
     */
    private loadChildren(node: FolderNode, lookAhead = true): void {
        node.pending = true;
        this.pageSvc.listPages({ parentId: node.id, space: this.state.spaceKey() }).pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError(() => of([] as PageDto[])),
        ).subscribe(items => {
            node.pending = false;
            node.children = this.toNodes(items);
            this.roots.update(list => [...list]);
            if (lookAhead) {
                this.prefetch(node.children);
            }
        });
    }

    /**
     * Silently resolve one level of children (#1714).
     *
     * The tree cannot tell "empty" from "not asked yet" — `children: null`
     * means the latter — so before this, every folder wore a chevron on spec
     * and the answer arrived only after a click, flashing a note in between.
     * Asking ahead of time makes `isKnownLeaf` truthful at the moment the row
     * is first painted: a childless section simply never grows a twisty, and
     * one that does have children expands with nothing in between.
     *
     * ONE level deep, never recursive: called for the roots on load and for a
     * folder's children once it is opened, so the tree stays exactly one step
     * ahead of the user instead of walking a whole subtree most of which will
     * never be looked at.
     */
    private prefetch(nodes: readonly FolderNode[]): void {
        for (const node of nodes) {
            if (null === node.children && !node.pending) {
                this.loadChildren(node, /* lookAhead */ false);
            }
        }
    }

    /** Directories only — the tree is a map of PLACES, not of content. */
    private toNodes(items: PageDto[]): FolderNode[] {
        return items
            .filter(item => 'directory' === item.nodeType)
            .map(item => ({
                id: item.id,
                path: item.vfsPath ?? '',
                name: item.slug,
                children: null,
                expanded: false,
                pending: false,
            }));
    }
}
