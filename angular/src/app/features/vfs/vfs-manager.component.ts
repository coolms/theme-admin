import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
    untracked,
    ElementRef,
    DestroyRef,
} from '@angular/core';
import { UserPreferencesService, NaviGraphNode, NaviGraphService, AppConfigState } from '@coolms/core-angular';
import { NgClass } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { VfsActionsService } from './vfs-actions.service';
import { VfsClipboardService } from './vfs-clipboard.service';
import { VfsUploadService } from './vfs-upload.service';
import {
    bindKeys,
    capabilityContext,
    CmsPageHeaderComponent,
    ExplorerLayoutComponent,
    FileEditorRegistry,
    PageFooterService,
    PageToolbarComponent,
    ToolbarAction,
    VfsViewMode,
} from '@coolms/ui-angular';
import { VfsPageStateService } from './vfs-page-state.service';

@Component({
    selector: 'app-vfs-manager',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // Focusable, so the keys can follow focus here (see the constructor).
    host: { tabindex: '-1' },
    providers: [VfsPageStateService, VfsActionsService, VfsClipboardService, VfsUploadService, PageFooterService],
    imports: [
        NgClass,
        PageToolbarComponent,
        CmsPageHeaderComponent,
        ExplorerLayoutComponent,
    ],
    template: `
        <app-explorer-layout
            layoutId="vfs:file-manager"
            [context]="pageContext()"
            (backgroundClick)="clearSelection()">

            <!-- Page header: fixed title + Upload primary action -->
            <cms-page-header
                explorer-header
                title="File System"
                icon="folder2-open"
                [actions]="headerActions()"
                (actionClick)="onVfsToolbarAction($event)" />

            <!-- Toolbar + clipboard — projected into ExplorerLayout's ng-content.
                 The breadcrumb has moved to a dedicated row at the top of the
                 file grid (rendered by VfsFilesSlotComponent); it no longer
                 lives in the toolbar so the toolbar's horizontal layout stays
                 stable as contextual actions appear / disappear. -->
            <app-page-toolbar
                [treeSlug]="toolbarTree"
                [context]="toolbarContext()"
                [iconsOnly]="true"
                (headerActionsChanged)="headerActions.set($event)"
                (actionClick)="onVfsToolbarAction($event)" />

            <!-- Clipboard indicator (shown when clipboard has content) -->
            @if (clipboard.hasAny()) {
                <div class="clipboard-indicator">
                    <i class="bi" [ngClass]="clipboard.hasCut() ? 'bi-scissors' : 'bi-clipboard'"></i>
                    <span>{{ clipboard.clipboard()!.nodes.length }} item{{ clipboard.clipboard()!.nodes.length === 1 ? '' : 's' }}</span>
                    <button type="button" class="cms-btn-ghost" style="padding:0 4px; border:none; background:none; cursor:pointer; font-size:.75rem; line-height:1"
                            title="Clear clipboard" (click)="clipboard.clear()">✕</button>
                </div>
            }

        </app-explorer-layout>
    `,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
        }
        .clipboard-indicator {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            margin-top: 6px;
            background: var(--cms-warning-light);
            border: 1px solid var(--cms-warning-subtle-border);
            border-radius: var(--cms-radius);
            font-size: .8125rem;
            color: var(--cms-warning-text);
            align-self: flex-start;
        }
    `],
})
export class VfsManagerComponent implements OnInit, OnDestroy {
    private readonly store          = inject(Store);
    private readonly route          = inject(ActivatedRoute);
    private readonly naviGraph      = inject(NaviGraphService);
    private readonly prefs          = inject(UserPreferencesService);
    protected readonly vfsActions   = inject(VfsActionsService);
    protected readonly clipboard    = inject(VfsClipboardService);
    readonly state                  = inject(VfsPageStateService);
    private  readonly footer        = inject(PageFooterService);
    private readonly editorRegistry = inject(FileEditorRegistry);

    viewMode      = this.state.viewMode;
    selectedNodes = this.state.selectedNodes;
    showHidden    = this.state.showHidden;
    currentPath   = this.state.currentPath;

    /** Alias to the shared state signal so the local toolbar computeds stay terse. */
    readonly toolbarNodes = this.state.vfsToolbarNodes;
    /** The manager's own element: its shortcuts act only on keys that come from inside it. */
    private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

    /**
     * Context passed to ExplorerLayout -- drives right panel
     * visibility. Right-panel decoupling: panel mounts only when
     * `panelOpen` is true AND an item is active (something to show).
     * Selection alone no longer opens the panel.
     */
    readonly pageContext = computed((): Record<string, unknown> => ({
        activeItem: this.state.panelOpen() ? this.state.activeItem() : null,
    }));

    constructor() {
        // The file manager's shortcuts belong to the page: while an editor, a viewer or a dialog is open over it,
        // none of them fires (Dmitry, 2026-10-14: Del in the image editor deleted the file underneath).
        bindKeys(event => this.onKeydown(event));
        // A press anywhere in the manager puts the keyboard here, even where the press itself moves no focus: on a
        // thumbnail's image the drag cancels the press's default (CDK does, for a natively draggable target).
        const takeFocus = (): void => {
            if (!this.hostEl.contains(document.activeElement)) this.hostEl.focus({ preventScroll: true });
        };
        this.hostEl.addEventListener('pointerdown', takeFocus, { capture: true });
        inject(DestroyRef).onDestroy(() => this.hostEl.removeEventListener('pointerdown', takeFocus, { capture: true }));

        // Keep the panel content in sync with selection: if the
        // active item is no longer selected (deletion, deselection,
        // directory change, multi-select), close the panel.
        effect(() => {
            const selected = this.selectedNodes();
            const active   = this.state.activeItem();
            if (active && (!selected.some(n => n.id === active.id) || selected.length > 1)) {
                untracked(() => {
                    this.state.activeItem.set(null);
                    this.state.panelOpen.set(false);
                });
            }
        });

        // Persist current path so it can be restored on the next session.
        effect(() => {
            const path = this.currentPath();
            untracked(() => this.prefs.setPageState('vfs', { lastPath: path }));
        });

        // Persist view mode.
        effect(() => {
            const mode = this.viewMode();
            untracked(() => this.prefs.setPageState('vfs', { viewMode: mode }));
        });

        // Keep footer status bar in sync with VFS state.
        effect(() => {
            const nodes    = this.state.nodes();
            const selected = this.state.selectedNodes();
            const loading  = this.state.loading();

            const dirs  = nodes.filter(n => n.type === 'directory').length;
            const files = nodes.filter(n => n.type !== 'directory').length;

            const parts: string[] = [];
            if (dirs  > 0) parts.push(`${dirs} dir${dirs   === 1 ? '' : 's'}`);
            if (files > 0) parts.push(`${files} file${files === 1 ? '' : 's'}`);
            if (!loading && nodes.length === 0) parts.push('Empty directory');

            this.footer.set({
                loading,
                count:    parts.length > 0 ? parts.join(', ') : undefined,
                selected: selected.length > 0 ? `${selected.length} selected` : undefined,
            });
        });
    }

    clearSelection(): void {
        this.state.clearSelection();
    }

    // -- Toolbar ---------------------------------------------------------------

    /**
     * The bar renders this tree; the page only says what state it is in.
     *
     * Three computed signals used to live here -- one building the header's
     * Upload by hand, one mapping visible nodes into the bar (with its own
     * divider trimming and a hardcoded "disable Delete for system nodes"), one
     * deciding which view-mode button looked pressed by comparing action ids.
     * All three were decisions the tree can state: `position: header`,
     * `disabledWhen`, `activeWhen`. What is left is the CONTEXT they are
     * evaluated against.
     *
     * The same record drives the right-click menu (VfsFiles / VfsTree pass it
     * to ContextMenuService), which is why `_surface` is here: it is the only
     * thing that differs between the two surfaces, and nodes that belong to one
     * of them say so themselves rather than being filtered out in code.
     */
    readonly toolbarTree = 'navi.toolbar.vfs';
    readonly headerActions = signal<ToolbarAction[]>([]);

    readonly toolbarContext = computed((): Record<string, unknown> => {
        const selected = this.selectedNodes();
        const single   = selected.length === 1;
        const node     = single ? selected[0] : null;

        const base = {
            _surface:      'toolbar',
            _viewMode:     this.viewMode(),
            _showHidden:   this.showHidden(),
            _hasClipboard: this.clipboard.hasAny(),
            // Delete hides for an all-system selection (`isSystem` below) and
            // greys out for a mixed one -- two different answers, two fields.
            _anySystemSelected: selected.some(n => n.isSystem),
        };

        if (selected.length === 0) {
            return {
                ...base,
                _context: 'background',
                _single:  false,
                type:     'directory',
                isSystem: false,
                isHidden: false,
            };
        }

        return {
            ...base,
            _context:   'node',
            _single:    single,
            type:       node?.type ?? 'file',
            isSystem:   single ? (node?.isSystem ?? false) : selected.every(n => n.isSystem),
            isHidden:   node?.isHidden ?? false,
            // Only meaningful for a single node; multi-select keeps them false
            // because both actions are single-target.
            hasEditor:  single && !!node && this.editorRegistry.resolve(node) !== null,
            canDrillIn: single && !!node && node.isContainer && node.permissions.execute,
            // What each declared node action comes to on the selection, the least across it, and how many
            // refuse it: a node naming a `capability` is disabled on `denied` (saying how many refuse) and
            // locked on `elevate` by the toolbar.
            ...capabilityContext(selected),
        };
    });

    // -- Action handler --------------------------------------------------------

    /**
     * A click on the bar. A node naming a `capability` goes through VfsActionsService.whenAllowed first -- a locked one asks
     * for elevation, a denied one does nothing (it is drawn disabled) -- and every other runs at once.
     */
    onVfsToolbarAction(action: string): void {
        const node = this.toolbarNodes().find(n => n.meta['action'] === action);
        this.vfsActions.whenAllowed(node, this.selectedNodes(), () => this.runToolbarAction(action));
    }

    private runToolbarAction(action: string): void {
        const selected    = this.selectedNodes();
        const target      = selected[0] ?? null;
        const currentPath = this.state.currentPath();

        switch (action) {
            // -- Background actions (NaviGraph keys) ---------------------------
            case 'VfsNewFolder':   void this.vfsActions.newFolder();            break;
            case 'VfsNewFile':     void this.vfsActions.newFile();              break;
            case 'VfsPaste':       void this.clipboard.paste(currentPath);      break;

            // -- Upload -- forwarded to VfsFilesSlotComponent via state subject -
            case 'upload':         this.state.uploadRequested$.next();          break;

            // -- Node actions: single-node ops ---------------------------------
            case 'VfsRename':      if (target) void this.vfsActions.rename(target); break;
            case 'VfsProperties':
                if (target) void this.vfsActions.execute(
                    { meta: { action: 'VfsProperties' } } as unknown as NaviGraphNode,
                    target,
                );
                break;

            // -- Node actions: multi-node ops ----------------------------------
            case 'VfsCut':         if (selected.length) this.clipboard.cut(selected);  break;
            case 'VfsCopy':        if (selected.length) this.clipboard.copy(selected); break;
            case 'VfsDelete':
                selected.filter(n => !n.isSystem)
                        .forEach(n => void this.vfsActions.confirmDelete(n));
                break;

            // -- Right-toolbar UI actions --------------------------------------
            case 'show-hidden':    this.state.toggleShowHidden();               break;
            case 'view-grid':      this.state.setViewMode('grid');              break;
            case 'view-list':      this.state.setViewMode('list');              break;

            // -- Delegate remaining NaviGraph actions (VfsDownload, VfsChmod, VfsChown ...)
            default: {
                const node = this.toolbarNodes().find(n => n.meta['action'] === action);
                if (node && target) void this.vfsActions.execute(node, target);
                break;
            }
        }
    }

    // -- Keyboard shortcuts ----------------------------------------------------

    /** Bound through the keyboard scope (the constructor); true when it acted on the key. */
    onKeydown(event: KeyboardEvent): boolean {
        // Within the page, the keys follow keyboard focus, not the mouse: a key from another panel (the terminal,
        // the side navigation) never acts on the file manager's selection.
        if (!(event.target instanceof Node) || !this.hostEl.contains(event.target)) return false;

        const ctrl     = event.ctrlKey || event.metaKey;
        const selected = this.state.selectedNodes();

        if (ctrl && event.key === 'x' && selected.length > 0) {
            this.clipboard.cut(selected);
            return true;
        }
        if (ctrl && event.key === 'c' && selected.length > 0) {
            this.clipboard.copy(selected);
            return true;
        }
        if (ctrl && event.key === 'v' && this.clipboard.hasAny()) {
            void this.clipboard.paste(this.state.currentPath());
            return true;
        }
        if (event.key === 'Escape') {
            // Clears the clipboard and lets the key go on: ESC still closes whatever else it closes.
            this.clipboard.clear();
            return false;
        }
        if (event.key === 'Delete' && selected.length > 0 && !selected.some(n => n.isSystem)) {
            // The key is the Delete button by another route: the same answer decides it.
            this.vfsActions.whenAllowed(
                this.toolbarNodes().find(n => n.meta['action'] === 'VfsDelete'),
                selected,
                () => selected.forEach(n => void this.vfsActions.confirmDelete(n)),
            );
            return true;
        }
        return false;
    }

    ngOnDestroy(): void {
        // VfsPageStateService is scoped to this component's providers array and
        // is destroyed automatically when this component is.  All HTTP subscriptions
        // managed with takeUntilDestroyed() are cancelled via DestroyRef.
        // This hook exists to document the cleanup contract and to allow future
        // explicit teardown if scoped state is ever moved to a global store.
    }

    ngOnInit(): void {
        // A `?path=` query param (e.g. the Site detail "Browse files" deep-link)
        // wins over the restored last path -- open the explorer at that folder.
        const saved     = this.prefs.getPageState<{ lastPath?: string; viewMode?: VfsViewMode }>('vfs');
        const queryPath = this.route.snapshot.queryParamMap.get('path');
        const startPath = (queryPath !== null && queryPath !== '') ? queryPath : (saved?.lastPath ?? '/');

        // `?select=` names a FILE inside `?path=` to land on. The
        // list endpoint only accepts directories, so a caller that knows a
        // file -- a notification announcing a generated document -- splits it
        // into folder + name rather than passing the file path itself.
        const select = this.route.snapshot.queryParamMap.get('select');
        if (select !== null && select !== '') {
            this.state.revealInDirectory(startPath, select);
        } else {
            this.state.navigateTo(startPath);
        }
        if (saved?.viewMode) {
            this.state.setViewMode(saved.viewMode);
        }

        // Load toolbar nodes from NaviGraph; state.vfsToolbarNodes is shared
        // with the canonical context menu so the tree fetch happens once.
        const url = this.store.selectSnapshot(AppConfigState.manifest)?.navi?.toolbarVfsGraph;
        if (url) {
            this.naviGraph.loadTree(url).subscribe(nodes => this.state.vfsToolbarNodes.set(nodes));
        }
    }
}
