import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    effect,
    inject,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import {
    ContextMenuService,
    ExplorerAccordionComponent,
    SpaceDto,
    SpaceSelectionStore,
} from '@coolms/ui-angular';
import { CollectionsTreeComponent } from './collections-tree.component';
import { MediaPageStateService } from './media-page-state.service';
import { MEDIA_ROOT_MENU_ITEMS } from './media-root-menu';
import { MediaService } from './media.service';

/**
 * Media Library left-pane wrapper. Composes the generic
 * {@link ExplorerAccordionComponent} with the existing
 * {@link CollectionsTreeComponent}; each accordion section represents
 * one "space" (Personal, Shared, per-site). Selecting a space rebinds
 * the collections tree to that space's `rootPath` and reloads.
 *
 * Spaces are fetched once on init from `GET /api/v1/media/spaces`.
 * When the response is empty (legacy installs without the
 * endpoint), the accordion falls back to a single "Shared" entry so
 * the existing flat experience still works.
 *
 * **Fetch/sort/restore now lives in {@link SpaceSelectionStore}** (extracted
 * when Articles became the third consumer). What stays here is exactly the
 * three things that are NOT shared: the state service this bridges to
 * (`currentDir`), the child tree it projects, and the side effect after a
 * space change (refilling collections through `MediaService`). That split is
 * why the store is a store and not a generic component — see its header.
 *
 * Registered as `CollectionsTree` in {@link app.config} so the
 * Media Library layout (`media:library` -> `content.panel.left`) picks
 * it up without further config changes.
 */
@Component({
    selector: 'app-media-space-accordion',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ExplorerAccordionComponent, CollectionsTreeComponent],
    providers: [SpaceSelectionStore],
    template: `
        <app-explorer-accordion
            persistKey="media:spaces"
            [spaces]="spaces()"
            [activeKey]="activeSpaceKey()"
            (spaceContextMenu)="onSpaceContextMenu($event)"
            (spaceChange)="onSpaceChange($event)">
            <app-collections-tree [embedded]="true"></app-collections-tree>
        </app-explorer-accordion>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        app-explorer-accordion { flex: 1; min-height: 0; overflow-y: auto; }
    `],
})
export class MediaSpaceAccordionComponent implements OnInit {
    readonly state = inject(MediaPageStateService);

    private readonly store = inject(SpaceSelectionStore);
    private readonly ngxs = inject(Store);
    private readonly svc = inject(MediaService);
    private readonly contextMenu = inject(ContextMenuService);
    private readonly destroyRef = inject(DestroyRef);

    readonly spaces = this.store.spaces;
    readonly activeSpaceKey = this.store.activeKey;

    constructor() {
        // Keep MediaPageStateService.currentDir in sync with the active
        // space root whenever the user switches spaces -- this triggers
        // the grid to reload via the existing effect chain on
        // currentDir() in MediaLibraryPage.
        //
        // The null bail-out is load-bearing. This effect flushes once
        // before the spaces response lands, when no space is resolved
        // yet. Substituting a default root here (the old `?? '/media'`)
        // made that first run compare the *restored* currentDir against
        // `/media`, decide it was out of scope, and reset it -- wiping
        // the persisted location before the store ever got to match it
        // to a space. Reloading always dropped the user back to Shared.
        // While the active space is unknown the right move is to leave
        // currentDir alone: it already holds the restored path, and the
        // store's own matching is what turns that path into a selection.
        effect(() => {
            const root = this.store.activeRootPath();
            if (null === root) {
                return;
            }

            untracked(() => {
                // The path bar's floor follows the resolved space, and must be
                // set on RESTORE too — not only when the operator
                // switches spaces, or a reload would leave it at the default
                // while the explorer sat in a different space.
                this.state.spaceRoot.set(root);
                if (this.state.currentDir() !== root && !this.state.currentDir().startsWith(root + '/')) {
                    this.state.currentDir.set(root);
                }
            });
        });
    }

    ngOnInit(): void {
        this.store.load({
            url: this.ngxs.selectSnapshot(AppConfigState.manifest)?.media?.spacesUrl,
            fallback: () => [this.legacyShared()],
            currentPath: () => this.state.currentDir(),
        });
    }

    onSpaceChange(key: string): void {
        const next = this.store.select(key);
        if (!next) return;
        this.state.currentDir.set(next.rootPath);
        // Publish the floor alongside the directory so the path bar
        // knows where this space starts.
        this.state.spaceRoot.set(next.rootPath);
        // Reload the collections tree against the new root path so the
        // body content reflects the active space.
        this.svc.listCollections(next.rootPath, 5).pipe(
            catchError(() => of([])),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(flat => this.state.collections.set(this.buildTree(flat)));
    }

    /**
     * Right-click a SPACE row. Media was the last explorer whose space
     * rows had no menu at all — the accordion has emitted `spaceContextMenu`
     * since it shipped, and Documents and Pages were the only listeners.
     *
     * ## Not the toolbar node set, unlike every other Media surface
     *
     * The collection menu is built from `toolbarNodes()` with
     * `_context: 'collection'`, and that set contains `rename` and `delete-col`
     * — both of which act on `currentDir()`. On a space row the current
     * directory IS the space root, so "Delete collection" there would offer to
     * delete the space. {@link MEDIA_ROOT_MENU_ITEMS} is the root-safe pair,
     * shared with the tree's "All media" row so the two cannot drift.
     *
     * ## Switch on OPEN, act on the space ROOT
     *
     * Choosing an action switches to the space if it is not active — the same
     * rule Pages and Documents follow, because these actions read the active
     * space and would otherwise file a new collection under whichever space the
     * operator happened to be in. The space root is pinned at ACTION time too:
     * right-clicking an already-active space while the cursor sits three
     * collections deep must still create at the ROOT the menu is attached to.
     *
     *  "Merely dismissing the menu must not move anybody" is what this
     * comment always said and what the code did not do until -- the
     * switch ran as the menu OPENED, so a right-click navigated.
     */
    onSpaceContextMenu(payload: { space: SpaceDto; event: MouseEvent }): void {
        payload.event.preventDefault();
        payload.event.stopPropagation();

        this.contextMenu.open(payload.event, [...MEDIA_ROOT_MENU_ITEMS], action => {
            //  The switch is HERE now -- this comment's own promise,
            // which the code broke by switching as the menu opened.
            if (payload.space.key !== this.activeSpaceKey()) {
                this.onSpaceChange(payload.space.key);
            }
            // The menu belongs to the row, so the row's root is the target.
            this.state.currentDir.set(payload.space.rootPath);

            if ('new-sub' === action) {
                this.state.newCollectionRequested$.next();
                return;
            }
            if ('upload' === action) {
                this.state.uploadRequested$.next();
            }
        });
    }

    private legacyShared(): SpaceDto {
        return { key: 'shared', label: 'Shared', rootPath: '/media', badge: null, isWritable: true, priority: 20 };
    }

    private buildTree(flat: { path: string; name: string; depth: number }[]): import('./media.types').CollectionNode[] {
        const root: import('./media.types').CollectionNode[] = [];
        const byPath = new Map<string, import('./media.types').CollectionNode>();
        for (const item of flat) {
            const node: import('./media.types').CollectionNode = { ...item, children: [] };
            byPath.set(item.path, node);
            const parentPath = item.path.split('/').slice(0, -1).join('/');
            const parent = byPath.get(parentPath);
            if (parent) parent.children.push(node);
            else root.push(node);
        }
        return root;
    }
}
