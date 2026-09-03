import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';

import type { DocumentInstance } from '@coolms/document-angular';
import { AppConfigState, UserPreferencesService, NaviGraphService, NaviGraphNode } from '@coolms/core-angular';
import { ExplorerViewMode, toExplorerViewMode } from '@coolms/ui-angular';
import { type DocumentFolder, type DocumentTemplate } from '../shared/document-explorer.types';

/**
 * Is a persisted path worth restoring at all?
 *
 * Shape only — whether it EXISTS and whether this user may read it are async
 * questions the constructor cannot ask. This rejects the values that are wrong
 * on their face: a previous build's empty string, a relative fragment, or a
 * traversal. Anything that gets past here and still fails to resolve is handled
 * by `forgetLastPath()`.
 */
function isRestorablePath(value: unknown): boolean {
    return typeof value === 'string'
        && value.startsWith('/')
        && !value.includes('..')
        && value.trim().length > 1;
}

export interface OpenInstanceRequest {
    readonly template: DocumentTemplate;
    readonly instance: DocumentInstance;
}

/**
 * Both Documents view modes are the SHARED explorer vocabulary.
 *
 * Was `'grid' | 'list'` in both cases, where `list` meant a hand-rolled table
 * with three click-to-sort headers. That table is now the platform DataGrid —
 * the mode it answers to is `details`, the same word Pages and Media use.
 */
export type DocumentViewMode = ExplorerViewMode;

/**
 *.1a: instances file zone has its own view mode independent
 * of the folder-content view mode — a user may want details-view for
 * instances (location column matters) but stay on tiles for templates.
 */
export type InstancesViewMode = ExplorerViewMode;

/**
 * Right panel can show either the template's metadata + naming +
 * Generate button (`properties`) or the full instances browser
 * with filter row + lazy-scroll list (`instances`). Toolbar toggles
 * between them; default is `properties` on every template change.
 */
export type RightPanelMode = 'properties' | 'instances';

export interface InstanceFilters {
    /** outputFormat eq — `null` means "all formats". */
    readonly outputFormat: string | null;
    /** status eq — `null` means "all statuses". */
    readonly status: string | null;
    /** name cn (LIKE %x%) — empty string means "no search". */
    readonly search: string;
}

/**
 * Single source of truth for the Document Library admin page. Slot
 * components read these signals; the page component subscribes to the
 * imperative subjects to react to user-driven actions (refresh,
 * delete, etc.) without forcing slots to know about each other.
 *
 * Mirrors `MediaPageStateService`'s shape — signals for state, RxJS
 * subjects for "the user wants something to happen" events. Provided
 * `providedIn: 'root'` like its Media sibling so slot components and
 * the page component all see the same instance.
 *
 * F.14c-3 swapped the explorer's slot contents to a VFS-tree-driven
 * layout. The state service now distinguishes between "a folder is
 * selected" (shows a folder content view) and "a template is
 * selected" (shows the template-detail panel). Both selections are
 * mutually exclusive — picking a folder clears the template id and
 * vice versa, so `selectedTemplate()` and `currentPath()` together
 * tell the main panel which view to render.
 */
@Injectable({ providedIn: 'root' })
export class DocumentPageStateService {
    private readonly naviGraph = inject(NaviGraphService);
    private readonly store = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly prefs = inject(UserPreferencesService);

    constructor() {
        // Restore the last folder BEFORE the space list is fetched.
        // `SpaceSelectionStore` re-selects a space by matching this path
        // against the space roots, so without it every reload lands on
        // whichever space sorts first -- the gap found and left
        // open here. Field initialisers have already run by the time the
        // constructor body executes, so `currentPath` exists to overwrite.
        const saved = this.prefs.getPageState<{
            lastPath?: string;
            viewMode?: string;
            instancesViewMode?: string;
        }>('documents');
        // ⚠️ VALIDATED, because a restored location that no longer works is
        // STICKY. The path is persisted on every change, so one navigation to a
        // folder that has since been deleted, had its permissions changed, or
        // belonged to a space that is no longer enabled is written back on the
        // next visit and again on the one after. The section becomes
        // permanently unusable and nothing tells the user why.
        //
        // ⚠️ The argument for this is already in this file, applied to the
        // lesser field: `toExplorerViewMode` below exists so "an unrecognised
        // mode must fall back to the default instead of restoring one the view
        // cannot draw". A path the explorer cannot open is the same problem with
        // a worse consequence, and it was restored raw.
        //
        // Shape only, here. Existence and permission are not knowable
        // synchronously in a constructor; `forgetLastPath()` is what the view
        // calls once it learns the restored path does not resolve.
        const lastPath = saved?.lastPath;
        if (isRestorablePath(lastPath)) {
            this.currentPath.set(lastPath as string);
        }

        // — Documents was the only explorer that forgot its view mode:
        // it persisted `lastPath` and nothing else, so every reload dropped
        // you back to Large icons however you had left it.
        //
        // `toExplorerViewMode` rather than a cast: the stored value is
        // whatever a previous build wrote, and an unrecognised mode must fall
        // back to the default instead of restoring one the view cannot draw.
        // No `list` remap here (the shape Media carries from ) — this key
        // has never been written before, so there is no legacy value to
        // translate.
        const restoredView = toExplorerViewMode(saved?.viewMode);
        if (null !== restoredView) {
            this.viewMode.set(restoredView);
        }
        const restoredInstances = toExplorerViewMode(saved?.instancesViewMode);
        if (null !== restoredInstances) {
            this.instancesViewMode.set(restoredInstances);
        }

        // Unlike Articles, `/docs` is a REAL value (the Shared space root),
        // not an empty bootstrap sentinel -- so there is nothing to skip
        // persisting. Writing it on a first visit records the truth.
        effect(() => {
            const path = this.currentPath();
            untracked(() => this.prefs.setPageState('documents', { lastPath: path }));
        });

        // Separate effects, one key each. `setPageState` MERGES
        // (`{...existing, ...state}`), so these cannot clobber `lastPath` —
        // and each only re-runs for its own signal rather than rewriting the
        // whole record whenever any of the three changes.
        effect(() => {
            const mode = this.viewMode();
            untracked(() => this.prefs.setPageState('documents', { viewMode: mode }));
        });
        effect(() => {
            const mode = this.instancesViewMode();
            untracked(() => this.prefs.setPageState('documents', { instancesViewMode: mode }));
        });

        // Self-load the toolbar tree once so context-menu openers can
        // synchronously hand `toolbarNodes()` to `openFromNodes`.
        const pattern = this.store.selectSnapshot(AppConfigState.manifest)?.navi?.graphBySlug;
        if (pattern) {
            const url = pattern.replace('{slug}', 'navi.toolbar.document');
            this.naviGraph
                .loadTree(url)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe((nodes) => this.toolbarNodes.set(nodes));
        }
    }

    // -- State signals ------------------------------------------------
    readonly templates = signal<DocumentTemplate[]>([]);

    /** Legacy "shared / personal" folder lists; F.14c-3 replaced
     *  consumers with the VFS-tree slot but kept the signals so the
     *  pre-F.14c-3 status bar / detail panels keep compiling until
     *  they're swept in a follow-up. */
    readonly sharedFolders = signal<DocumentFolder[]>([]);
    readonly personalFolders = signal<DocumentFolder[]>([]);

    /** Currently focused template id — drives the right detail panel. */
    readonly selectedId = signal<string | null>(null);
    /** True while the templates list is being fetched. */
    readonly loading = signal(false);

    /** Active folder path; drives the folder-content view in the main panel. */
    readonly currentPath = signal<string>('/docs');

    /**
     * Root of the space `currentPath` sits in, published by the space
     * accordion (the only component that owns a `SpaceSelectionStore`).
     *
     * `currentPath` alone can't stand in for it: it may be a subfolder,
     * and the breadcrumb needs to know how far UP the module is willing
     * to go. Above the space root the chain is real but unreachable —
     * Documents has no view for `/`, `/home` or `/home/{uuid}`.
     *
     * `null` until the spaces response lands.
     */
    readonly spaceRoot = signal<string | null>(null);

    /**
     * Bumped when a subfolder is created. The folder chips and
     * the tree key their fetch on the PATH, which does not change when a
     * child appears underneath it — without this they would keep showing
     * the pre-create listing until the user navigated away and back.
     */
    readonly folderVersion = signal(0);

    /** Rendering of the folder-content (templates) view. */
    readonly viewMode = signal<DocumentViewMode>('large');

    /**.1a: separate view mode for the instances file zone. */
    readonly instancesViewMode = signal<InstancesViewMode>('large');

    /**: which right-panel surface is mounted when a template is selected. */
    readonly rightPanelMode = signal<RightPanelMode>('properties');

    /**
     * — the SPACE scope for instances mode.
     *
     * Instances mode answers one of two questions, and this signal is
     * the discriminator:
     *   `null`      -> "what did THIS TEMPLATE produce?" (scope is
     *                 `selectedTemplate`, the original.1a view)
     *   `<vfsPath>` -> "what has THIS SPACE produced?" (scope is the
     *                 VFS root, reached by clicking the space segment
     *                 in the breadcrumb)
     *
     * Deliberately reusing `rightPanelMode === 'instances'` rather than
     * adding a third mode: everything downstream of it — the instance
     * detail panel, the toolbar's `_kind`, the filter projection, the
     * open/download/regenerate handlers — is already scope-agnostic, so
     * the space view inherits the lot instead of forking it.
     */
    readonly instancesScopePath = signal<string | null>(null);

    /**
     * — which of the three views the main pane is showing. ONE
     * definition, read by the pane router, the breadcrumb and the
     * toolbar/context records, so they cannot disagree about where the
     * user is:
     *
     *   `templates` — the space's template listing (the default)
     *   `documents` — everything the space produced
     *   `instances` — everything ONE template produced
     *
     * `rightPanelMode` alone can't answer this: the two instance views
     * share it, and it can briefly read `instances` with nothing in
     * scope while the revert effect settles. The order below mirrors
     * `DocumentGridComponent.showInstances()` exactly.
     */
    readonly browseView = computed<'templates' | 'documents' | 'instances'>(() => {
        if (null !== this.instancesScopePath()) {
            return 'documents';
        }
        if ('instances' === this.rightPanelMode() && null !== this.selectedTemplate()) {
            return 'instances';
        }

        return 'templates';
    });

    /**
     * hotfix #3: panel visibility is its own signal, not derived
     * from selection. Single-click on a tile/card both selects AND opens
     * the panel; right-click only selects. Mode-properties toolbar toggle
     * flips this without touching selection.
     */
    readonly propertiesPanelOpen = signal<boolean>(false);

    /**: instances-browser filter state. Reset on template change. */
    readonly instanceFilters = signal<InstanceFilters>({
        outputFormat: null,
        status: null,
        search: '',
    });

    /**
     *: total count of instances for the selected template,
     * surfaced as a badge on the Show Instances toolbar toggle. `0` when
     * no template is selected.
     */
    readonly instanceCount = signal<number>(0);

    /**
     *.1b: focused instance in the file zone. Drives the
     * three-pane layout in instances mode — when non-null the right
     * detail panel mounts InstanceDetail; null leaves the file zone
     * full-width.
     */
    readonly selectedInstance = signal<DocumentInstance | null>(null);

    /**
     * F.14c-3: paths of tree nodes whose children have been fetched
     * and should render expanded. The folders-tree component owns
     * mutations — it adds the path on first expand and removes it on
     * collapse. Living on the state service means the page-level
     * "select a folder" action can reveal the matching node by
     * adding ancestors to this set if a future deep-link feature
     * needs it.
     */
    readonly expandedPaths = signal<ReadonlySet<string>>(new Set());

    // -- Derived signals ----------------------------------------------
    readonly selectedTemplate = computed(() => {
        const id = this.selectedId();
        if (id === null) {
            return null;
        }
        return this.templates().find((t) => t.id === id) ?? null;
    });

    readonly totalCount = computed(() => this.templates().length);
    readonly selectedCount = computed(() => (this.selectedId() === null ? 0 : 1));

    /**
     * NaviGraph node whose meta drives the right-panel header (icon +
     * title). Reads `mode-properties` or `mode-instances` from
     * `toolbarNodes` based on `rightPanelMode`, so the panel header
     * reflects WHICH content the panel is currently showing instead
     * of always saying "Properties". Returns null when the panel is
     * closed.
     */
    readonly panelNode = computed<NaviGraphNode | null>(() => {
        if (!this.propertiesPanelOpen()) return null;
        const targetAction = this.rightPanelMode() === 'instances'
            ? 'mode-instances'
            : 'mode-properties';
        return this.toolbarNodes().find((n) => n.meta?.['action'] === targetAction) ?? null;
    });

    // -- Imperative event subjects ------------------------------------
    /** Page subscribes; slots emit when they need a fresh fetch. */
    readonly refreshRequested$ = new Subject<void>();
    /** Slots dispatch a focused action up to the page (deletion, generation, etc.). */
    readonly deleteRequested$ = new Subject<DocumentTemplate>();
    readonly previewLatestRequested$ = new Subject<DocumentTemplate>();
    /** F.14c-3: emitted when the user double-clicks a row in the
     *  template-detail's instances list. The page opens the viewer
     *  modal — keeps the detail component free of dialog deps. */
    readonly openInstanceRequested$ = new Subject<OpenInstanceRequest>();
    /**
     *: emitted when the user double-clicks a template tile or
     * row. The page decides whether to open a viewer modal (imported
     * templates) or surface the "native editor coming soon"
     * placeholder (native templates). Generate stays as an explicit
     * action — toolbar / properties panel.
     */
    readonly templateOpenRequested$ = new Subject<DocumentTemplate>();

    /**
     * E6 — folder-content's empty-area `<cms-dropzone>` emitted DOCX
     * files. Page subscribes and calls the existing upload flow (one
     * POST per file against `currentPath()`).
     */
    readonly uploadFilesRequested$ = new Subject<File[]>();

    /**
     * E6 — folder-tree "Upload here" right-click action. Carries the
     * target folder path so the page can scope the upload dialog to
     * the right-clicked section/folder instead of `currentPath()`.
     */
    readonly uploadToFolderRequested$ = new Subject<string>();

    /**
     * — files dropped on the DOCUMENTS zone. Separate from
     * `uploadFilesRequested$`, which routes through the template
     * service and lands under `.templates`.
     */
    readonly uploadDocumentsRequested$ = new Subject<File[]>();

    /** — "New folder here" from a tree/space right-click. Carries
     *  the RIGHT-CLICKED path, not `currentPath`. */
    readonly newFolderInRequested$ = new Subject<string>();

    /**
     *.1b backend ops: emitted by anything that mutates the
     * instances collection (delete, regenerate, generate-success) to
     * tell the InstancesBrowser to refetch its current page. Cheaper
     * than tearing down + rebuilding the whole template selection.
     */
    readonly refreshInstancesRequested$ = new Subject<void>();

    /**
     * Cached `navi.toolbar.document` nodes used by both the page
     * toolbar and the right-click context menus. Loaded once on
     * service construction; consumers feed `toolbarNodes()` into
     * `ContextMenuService.openFromNodes()` (mirrors the
     * `DomainExplorerStateService.domainToolbarNodes` pattern).
     */
    readonly toolbarNodes = signal<NaviGraphNode[]>([]);

    /**
     * Bus from context-menu / sub-component action emitters back to the
     * page's `onToolbarAction(action)` handler. Single dispatch point —
     * no per-action subjects, so adding a new action means one switch
     * branch on the page, not a new state-service field.
     */
    readonly actionDispatched$ = new Subject<string>();

    dispatchAction(action: string): void {
        this.actionDispatched$.next(action);
    }

    // -- Folder/template selection helpers ----------------------------

    /**
     * Switching to a folder clears any template selection so the main
     * panel renders the folder-content view, not the template-detail
     * panel. Selecting a template (`selectedId.set(...)`) doesn't
     * touch the path — it overlays the detail view.
     */
    /**
     * Forget the remembered location and go back to the space root.
     *
     * ⚠️ Called when the restored path turns out not to resolve — deleted,
     * permissions changed, or its space no longer enabled. Without it the
     * failure is reproduced on every visit, because the path is persisted on
     * every change and the bad value is simply written back.
     *
     * Falling back to the root is deliberately not the same as clearing the
     * stored key: the user still lands somewhere usable, and the effect that
     * persists `currentPath` records the root, which is what un-sticks it.
     */
    forgetLastPath(root: string): void {
        this.currentPath.set(root);
    }

    selectFolder(path: string): void {
        this.currentPath.set(path);
        this.selectedId.set(null);

        // — a folder BELOW the space root cannot hold templates:
        // `TemplateRootResolver` recognises only `<spaceRoot>/.templates`.
        // So picking a subfolder in the tree is DOCUMENTS navigation, and
        // staying in the templates view left the pane showing the space's
        // templates under a `Templates` breadcrumb no matter which folder
        // was selected — the tree row highlighted and nothing else moved.
        // Selecting the space root itself leaves the current view alone,
        // which is what keeps the accordion's own re-sync from yanking the
        // user out of Templates.
        const root = this.spaceRoot();
        if (null === root || '' === root) {
            return;
        }
        if (path.replace(/\/+$/, '') !== root.replace(/\/+$/, '')) {
            this.instancesScopePath.set(path);
            this.rightPanelMode.set('instances');
        }
    }

    selectTemplate(id: string | null): void {
        this.selectedId.set(id);
    }

    bumpFolderVersion(): void {
        this.folderVersion.update((v) => v + 1);
    }

    setExpanded(path: string, expanded: boolean): void {
        const next = new Set(this.expandedPaths());
        if (expanded) {
            next.add(path);
        } else {
            next.delete(path);
        }
        this.expandedPaths.set(next);
    }

    setRightPanelMode(mode: RightPanelMode): void {
        // Every caller of this is the TEMPLATE-scoped path (the toolbar's
        // Show Instances toggle, the revert-to-browsing effect). Clearing
        // the space scope here means the two scopes can never both be
        // live, so `instancesScopePath` alone answers "which question is
        // this view answering?".
        this.instancesScopePath.set(null);
        this.rightPanelMode.set(mode);
    }

    /**
     * — enter the space-scoped Documents view: "everything this
     * space has produced", regardless of which template produced it.
     *
     * Reached by clicking the space segment in the breadcrumb while
     * browsing templates. The way BACK is the Templates folder tile the
     * instances browser renders in this scope — the space root is the
     * last breadcrumb segment here, so it isn't a link.
     */
    enterSpaceDocuments(rootPath: string): void {
        this.selectedId.set(null);
        this.instancesScopePath.set(rootPath);
        this.rightPanelMode.set('instances');
    }

    /**
     * — show the template listing at the current path, from
     * either instances view. Reached by the Templates folder chip in
     * the space view and by the `Templates` breadcrumb segment in a
     * template's instances view.
     */
    showTemplates(): void {
        // Templates are per-SPACE, not per-folder: `TemplateRootResolver`
        // only recognises `<spaceRoot>/.templates`, so a `.templates`
        // inside a subfolder would be inert — not a template root, not
        // discovered, not writable through the template endpoints.
        // Entering the Templates view therefore always returns to the
        // space root; leaving `currentPath` on a subfolder would show an
        // empty listing and a Templates breadcrumb pointing at a
        // directory that neither exists nor should.
        const root = this.spaceRoot();
        if (null !== root && '' !== root) {
            this.currentPath.set(root);
        }
        this.selectedId.set(null);
        this.instancesScopePath.set(null);
        this.rightPanelMode.set('properties');
    }

    setPropertiesPanelOpen(open: boolean): void {
        this.propertiesPanelOpen.set(open);
    }

    togglePropertiesPanelOpen(): void {
        this.propertiesPanelOpen.update((o) => !o);
    }

    setInstanceFilter<K extends keyof InstanceFilters>(key: K, value: InstanceFilters[K]): void {
        this.instanceFilters.update((f) => ({ ...f, [key]: value }));
    }

    resetInstanceFilters(): void {
        this.instanceFilters.set({ outputFormat: null, status: null, search: '' });
    }

    setInstanceCount(count: number): void {
        this.instanceCount.set(count);
    }

    selectInstance(instance: DocumentInstance | null): void {
        this.selectedInstance.set(instance);
    }
}
