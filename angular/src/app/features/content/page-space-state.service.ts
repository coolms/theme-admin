import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { AppConfigState, NaviGraphService, NaviGraphNode, UserPreferencesService } from '@coolms/core-angular';
import { ExplorerViewMode } from '@coolms/ui-angular';
import { PageDto, PageTypeDto } from './page.types';

/**
 * Main-pane rendering.
 *
 * Was a Pages-local `'list' | 'grid'` copied from Documents; now the SHARED
 * {@link ExplorerViewMode}, because copying a vocabulary between two
 * modules is how three explorers ended up with three names for one control.
 * The set of modes Pages offers is declared in `content:pages-list` YAML.
 */
export type PageViewMode = ExplorerViewMode;

/**
 * Shared state between the Pages explorer's two slot components — the space
 * accordion in `content.panel.left` and the tree grid in `content.main`
 *.
 *
 * They are siblings assembled by `ExplorerLayout` from the layout YAML, so
 * they cannot talk directly; this is the seam, exactly as
 * `DocumentPageStateService` and `ArticlePageStateService` are for their
 * explorers.
 *
 * Deliberately small. The Pages grid already owns its own tree, filter and
 * pagination state — the only thing it needs from the accordion is *which
 * space am I listing*, so that is all this carries. Duplicating the grid's
 * state here would give two owners for one fact.
 *
 * Provided at the ROUTE, not root: two Pages explorers open in different
 * tabs must not share a selected space.
 */
/** Per-user preference bucket for this explorer. */
const PREFS_KEY = 'content_pages';

@Injectable()
export class PageSpaceStateService {
    private readonly prefs = inject(UserPreferencesService);
    private readonly naviGraph = inject(NaviGraphService);
    private readonly ngxs = inject(Store);
    private readonly destroyRef = inject(DestroyRef);

    /**
     * Active space key (`personal`, `site:default`), or `''` before the
     * spaces response lands.
     *
     * The KEY is the wire value, never the path: the backend resolves it
     * through the registry, so a client that sent a path could name a
     * directory it was never offered.
     */
    readonly spaceKey = signal<string>('');

    /**
     * VFS root of the active space. Held for display only — the breadcrumb
     * and the "which ancestors are navigable" floor. Requests are keyed on
     * `spaceKey`.
     */
    readonly spaceRoot = signal<string>('');

    /** Human label of the active space, for the header/breadcrumb. */
    readonly spaceLabel = signal<string>('');

    /**
     * Site slug of the active space, or null for Personal.
     *
     * Null is meaningful rather than missing: a page in a personal space
     * belongs to no site, so placement has no destination to default to and
     * the UI has to ask.
     */
    readonly siteSlug = signal<string | null>(null);

    /**
     * The selected page, or null.
     *
     * Lives here because the TOOLBAR is rendered by the host page and the
     * PROPERTIES PANEL is a third slot, while the selection belongs to
     * the listing in `content.main` — siblings that cannot see each other.
     *
     * It was a bare `hasSelection` boolean while the toolbar predicate was the
     * only consumer. The panel needs the row itself, and publishing the DTO is
     * not a second owner for the same fact — the listing still WRITES it and
     * nothing else does; the boolean below is now derived rather than stored,
     * so the two can no longer drift.
     */
    readonly selectedPage = signal<PageDto | null>(null);

    /** Whether the listing currently has a row selected — the toolbar's `_selected`. */
    readonly hasSelection = computed(() => null !== this.selectedPage());

    /**
     * Whether the properties panel is showing.
     *
     * SEPARATE from the selection, and the separation is load-bearing: the
     * layout gates the panel on `activeItem`, so closing it by clearing the
     * selection would leave the grid row still highlighted while the toolbar
     * lost its row actions — the close button silently deselecting behind the
     * user's back.
     *
     * Starts CLOSED and opens only on the explicit Properties action.
     * It used to open on selection, which put a 340px panel in front of the
     * listing on every single click — and single-click is the first half of
     * the double-click that opens the editor, so the pane jittered under the
     * user mid-gesture. Selection and "show me everything about this" are two
     * different intents.
     */
    readonly panelOpen = signal(false);

    /**
     * Configured page kinds, published by the listing that loads them.
     *
     * Shared rather than fetched per consumer: the tiles need `key -> label`
     * and so does the properties panel, and the catalogue cannot change
     * between them. A panel with its own fetch would put a request behind
     * every row click for a constant.
     */
    readonly pageTypes = signal<readonly PageTypeDto[]>([]);

    /**
     * Which rendering the main pane uses.
     *
     * Set by the switcher the HOST renders and obeyed by the sibling slot that
     * draws the items — the same seam the folder cursor uses.
     *
     * Seeded to `details` to match the layout's `defaultViewMode`; the host
     * overwrites it from the layout config once that resolves, so this literal
     * only covers the moment before the YAML lands.
     */
    readonly viewMode = signal<PageViewMode>('details');

    /**
     * The folder both views are showing, as the chain walked down from the
     * space root — the empty trail IS the root.
     *
     * A TRAIL rather than a bare path because the backend lists children by
     * Node id (`?parent=`), so walking back up needs each ancestor's id, and
     * the only place those exist is the node that was clicked coming down.
     *
     * It lives HERE, not in the grid, because the folder tree in the left panel
     * and the listing in the main pane are sibling slots: the panel sets the
     * cursor, the listing obeys it, and neither can see the other. It was
     * private to the listing while the grid was its own navigator —
     * moving it out is what lets navigation leave the grid entirely.
     */
    readonly trail = signal<ReadonlyArray<{ id: string; path: string }>>([]);

    /** Node id to list children of; null at the space root. */
    readonly folderId = computed<string | null>(() => {
        const trail = this.trail();

        return 0 === trail.length ? null : trail[trail.length - 1].id;
    });

    /** Absolute path of the folder on screen — what the breadcrumb renders. */
    readonly folderPath = computed<string>(() => {
        const trail = this.trail();

        return 0 === trail.length ? this.spaceRoot() : trail[trail.length - 1].path;
    });

    /**
     * Enter a folder (append) — used by the tree, the tiles and the grid alike.
     * Re-entering the folder already on screen is a no-op rather than a
     * duplicate trail entry.
     */
    enterFolder(id: string, path: string): void {
        if (this.folderId() === id) {
            return;
        }
        this.trail.update(trail => [...trail, { id, path }]);
    }

    /**
     * Jump to an ancestor by PATH, or to the space root when the path is the
     * root itself. Unknown paths are ignored: the trail is the only place the
     * ids exist, so a path nobody walked down to cannot be resolved — which is
     * also why the breadcrumb's address bar stays off.
     */
    goToPath(path: string): void {
        if (path === this.spaceRoot()) {
            this.trail.set([]);

            return;
        }
        const trail = this.trail();
        const index = trail.findIndex(step => step.path === path);
        if (index >= 0) {
            this.trail.set(trail.slice(0, index + 1));
        }
    }

    /** Back to the space root — e.g. when the space itself changes. */
    resetFolder(): void {
        this.trail.set([]);
    }

    /**
     * Toolbar/header actions travelling from the host page down to the grid.
     *
     * The mirror of `DocumentPageStateService.actionDispatched$` and the same
     * reason: the component that RENDERS the action is not the one that can
     * PERFORM it.
     */
    readonly actionRequested$ = new Subject<string>();

    /**
     * An action aimed at a SPECIFIC section, not at the cursor.
     *
     * Separate from `actionRequested$` because the target is the point: section
     * properties opens on the folder that was right-clicked, and the folder
     * menu deliberately does not move the cursor ([]) — so the path has to
     * travel with the request rather than be read from shared state afterwards.
     */
    readonly sectionActionRequested$ = new Subject<{
        readonly action: string;
        readonly path: string;
        readonly label: string;
    }>();

    /**
     * The Pages toolbar tree, loaded once here.
     *
     * Lives in shared state because THREE slots need it and none can see the
     * others: the toolbar renders it, the folder tree opens a folder menu from
     * it, and the listing opens a background menu from it. `PageToolbarComponent`
     * loads its own copy for rendering; this one exists so a context-menu
     * opener can hand `openFromNodes` a synchronous array at right-click time
     * instead of fetching mid-gesture. Same shape as Documents.
     */
    readonly toolbarNodes = signal<NaviGraphNode[]>([]);

    constructor() {
        const pattern = this.ngxs.selectSnapshot(AppConfigState.manifest)?.navi?.graphBySlug;
        if (undefined !== pattern && null !== pattern) {
            this.naviGraph
                .loadTree(pattern.replace('{slug}', 'navi.toolbar.content.pages'))
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(nodes => this.toolbarNodes.set(nodes));
        }

        // — remember which space was open. Pages was the only explorer
        // that did not, so every reload dropped you back into Personal even if
        // you had spent the session in a site.
        //
        // The ROOT PATH is what is persisted, not the key: `SpaceSelectionStore`
        // resolves the active space by matching the explorer's current path
        // against each space's `rootPath`, and it reads that path through a
        // getter AFTER the spaces response lands. Restoring the root here is
        // therefore all the wiring the accordion needs — it already asks.
        const saved = this.prefs.getPageState<{ spaceRoot?: string }>(PREFS_KEY);
        if (undefined !== saved?.spaceRoot && '' !== saved.spaceRoot) {
            this.spaceRoot.set(saved.spaceRoot);
        }

        effect(() => {
            const root = this.spaceRoot();
            if ('' === root) {
                return;
            }
            untracked(() => this.prefs.setPageState(PREFS_KEY, { spaceRoot: root }));
        });
    }
}
