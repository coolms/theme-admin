import {
    ChangeDetectionStrategy,
    Component,
    OnInit,
    effect,
    inject,
    untracked,
} from '@angular/core';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import {
    ContextMenuService,
    ExplorerAccordionComponent,
    SpaceDto,
    SpaceSelectionStore,
} from '@coolms/ui-angular';
import { PageFoldersTreeComponent } from './page-folders-tree.component';
import { PageSpaceStateService } from './page-space-state.service';

/**
 * Pages left-pane space selector — the fourth consumer of
 * {@link SpaceSelectionStore}.
 *
 * Personal (`/home/{uuid}/pages`) and one entry per active site, rooted at the
 * SECTION ROOT so the site's page tree is the space.
 *
 * It projects the FOLDER TREE. The original comment here said the
 * opposite — that a tree belonged in `content.main` because the grid rendered
 * its own, and a second one would give "two trees disagreeing about where they
 * are". The disagreement was real; the conclusion was backwards. The grid is
 * flat now and the navigator lives here, next to the space it belongs to,
 * which is where Documents and the file manager already put it.
 *
 * There is no legacy fallback. `/content/pages/spaces` ships with this
 * feature, so an install without it has no Pages explorer either — Media and
 * Documents carry fallbacks only because they predate their spaces endpoints.
 */
@Component({
    selector: 'app-page-space-accordion',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ExplorerAccordionComponent, PageFoldersTreeComponent],
    providers: [SpaceSelectionStore],
    template: `
        <app-explorer-accordion
            persistKey="content:page-spaces"
            [spaces]="spaces()"
            [activeKey]="activeSpaceKey()"
            (spaceContextMenu)="onSpaceContextMenu($event)"
            (spaceChange)="onSpaceChange($event)">
            <!-- Projected into the ACTIVE section only — the accordion has a
                 single ng-content, so the tree follows the open space. -->
            <app-page-folders-tree [rootPath]="activeRootPath() ?? ''" />
        </app-explorer-accordion>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        app-explorer-accordion { flex: 1; min-height: 0; overflow-y: auto; }
    `],
})
export class PageSpaceAccordionComponent implements OnInit {
    private readonly state = inject(PageSpaceStateService);
    private readonly store = inject(SpaceSelectionStore);
    private readonly ngxs = inject(Store);
    private readonly contextMenu = inject(ContextMenuService);

    readonly spaces = this.store.spaces;
    readonly activeSpaceKey = this.store.activeKey;

    /** Root of the open space — what the projected folder tree lists from. */
    readonly activeRootPath = this.store.activeRootPath;

    constructor() {
        // Publish the resolved space into shared state, which is what the grid
        // reloads from. Reads the store's NULLABLE root and bails while it is
        // null: substituting a default here would pin every reload to the
        // first space before the spaces response lands.
        effect(() => {
            const root = this.store.activeRootPath();
            const key = this.store.activeKey();
            const active = this.store.spaces().find(s => s.key === key);
            if (null === root) {
                return;
            }

            untracked(() => this.publish(key, root, active));
        });
    }

    ngOnInit(): void {
        this.store.load({
            url: this.ngxs.selectSnapshot(AppConfigState.manifest)?.content?.pageSpacesUrl ?? null,
            fallback: (): SpaceDto[] => [],
            // A getter, evaluated after the response lands, so it sees the
            // root restored from prefs rather than the bootstrap value.
            currentPath: () => this.state.spaceRoot(),
        });
    }

    /**
     * Right-click a SPACE — Pages bound `spaceChange` and nothing
     * else, so the space rows were the one part of the explorer with no menu
     * at all. The accordion has emitted `spaceContextMenu` since it shipped;
     * only Documents ever listened.
     *
     * ## This one DOES switch space first, unlike the folder menu
     *
     * `page-folders-tree` deliberately does not navigate on right-click —
     * "a context menu is a question, not a command" — because its entries
     * (`openCreateDialog` and friends) are SPACE-scoped and never read the
     * folder cursor, so selecting bought nothing.
     *
     * That same fact inverts the answer here. Space-scoped actions read the
     * ACTIVE space, so opening this menu on an inactive space and choosing
     * "New Page" would create the page in whichever space you happened to be
     * in — silently, in a different site.
     *
     *  So the switch stays, but it moved to ACTION time. Switching as
     * the menu OPENED meant a right-click navigated, and dismissing the menu
     * left the operator in another space having chosen nothing.
     */
    onSpaceContextMenu(payload: { space: SpaceDto; event: MouseEvent }): void {
        const nodes = this.state.toolbarNodes();
        if (0 === nodes.length) {
            // The toolbar graph has not landed (or is empty); an empty menu is
            // worse than none.
            return;
        }
        payload.event.preventDefault();
        payload.event.stopPropagation();

        this.contextMenu.openFromNodes(
            payload.event,
            [...nodes],
            { _kind: 'folder', _selected: false, _surface: 'context' },
            action => {
                // `open-folder` on a space IS the switch -- and since the
                // menu no longer performs one on the way open, this is
                // where it happens. Re-emitting the action would ask the tree
                // to select a folder that is the space root and has no node of
                // its own, so the switch is the whole of it.
                if ('open-folder' === action) {
                    if (payload.space.key !== this.activeSpaceKey()) {
                        this.onSpaceChange(payload.space.key);
                    }

                    return;
                }
                // Section properties need the target path — for a space that
                // is its root, not the folder cursor ('s contract).
                if ('section-properties' === action) {
                    this.state.sectionActionRequested$.next({
                        action,
                        path: payload.space.rootPath,
                        label: payload.space.label,
                    });

                    return;
                }
                //  At ACTION time, not at open time. These read the
                // ACTIVE space, so "New page" on another space's row would
                // create the page in a different site -- silently. Switching
                // when the action is CHOSEN keeps that right without making a
                // dismissed menu move anybody.
                if (payload.space.key !== this.activeSpaceKey()) {
                    this.onSpaceChange(payload.space.key);
                }
                this.state.actionRequested$.next(action);
            },
        );
    }

    onSpaceChange(key: string): void {
        const next = this.store.select(key);
        if (!next) return;

        this.publish(next.key, next.rootPath, next);
    }

    /**
     * Write the active space into shared state.
     *
     * Each signal is compared before writing so an unchanged value does not
     * retrigger the grid's reload effect — and the KEY is written even when
     * the root already matched, because on a restored reload the root arrives
     * from prefs before any space resolves: gating the key on the root would
     * leave the grid with an empty key and it would never load.
     */
    private publish(key: string, root: string, space: SpaceDto | undefined): void {
        // `?? null` collapses "absent" and "explicitly null" on purpose: both
        // mean this space belongs to no site.
        const siteSlug = space?.siteSlug ?? null;
        const label = space?.label ?? '';

        if (this.state.spaceRoot() !== root) {
            this.state.spaceRoot.set(root);
        }
        if (this.state.spaceKey() !== key) {
            this.state.spaceKey.set(key);
        }
        if (this.state.spaceLabel() !== label) {
            this.state.spaceLabel.set(label);
        }
        if (this.state.siteSlug() !== siteSlug) {
            this.state.siteSlug.set(siteSlug);
        }
    }
}
