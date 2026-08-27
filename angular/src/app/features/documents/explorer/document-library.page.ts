import { Dialog } from '@angular/cdk/dialog';

import { FormsModule } from '@angular/forms';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, switchMap } from 'rxjs/operators';

import { DocumentInstanceService } from '@coolms/document-angular';
import type { DocumentInstance } from '@coolms/document-angular';
import {
    ViewerModalComponent,
    ViewerModalData,
} from '@coolms/document-viewer-angular';

import { HttpClient } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { AppConfigState } from '@coolms/core-angular';
import { CmsPageHeaderComponent, ConfirmDialogService, EscCoordinatorService, ExplorerLayoutComponent, ExplorerViewMode, ExplorerViewSwitcherComponent, FileEditorRegistry, NativeDialogService, PageFooterService, PageToolbarComponent, ToastService, ToolbarAction, type VfsNodeDto } from '@coolms/ui-angular';
import { type DocumentTemplate } from '../shared/document-explorer.types';
import { ApiService } from '../../../api/api.service';
import { WordTemplateService } from '../word/word-template.service';
import { NativeDocumentService } from '../word/native-document.service';
import { DocumentAggregatorService } from './document-aggregator.service';
import { DocumentPageStateService } from './document-page-state.service';
import { filenameOf } from './vfs-location.helpers';
import { DocumentUploadDialog, DocumentUploadDialogData } from './document-upload.dialog';
import { FormatInfoService } from './format-info.service';
import {
    extensionForSourceMime,
    inferTemplateSourceMime,
    templateSourceFilename,
} from './template-source.helpers';
import {
    EditTemplateDialogComponent,
    type EditTemplateDialogData,
} from './edit-template-dialog.component';
import {
    ReplaceTemplateDialogComponent,
    type ReplaceTemplateDialogData,
} from './replace-template-dialog.component';
import {
    TemplateConflictDialogComponent,
    type TemplateConflictDialogData,
    type TemplateConflictDialogResult,
    type TemplateNameConflictPayload,
} from './template-conflict-dialog.component';
import {
    CmsDocumentGenerationWizardComponent,
    type CmsDocumentGenerationWizardData,
    type CmsDocumentGenerationWizardResult,
} from '../generation-wizard/cms-document-generation-wizard.component';

/**
 * Type guard: did the HTTP error originate from the backend's
 * template-name-conflict listener? Matches the canonical suffix
 * inside the RFC 7807 `type` URL so the listener can move hosts
 * without breaking the frontend gate.
 */
function isTemplateNameConflict(err: unknown): err is { status: 409; error: TemplateNameConflictPayload } {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { status?: number; error?: { type?: unknown } };
    return e.status === 409
        && typeof e.error?.type === 'string'
        && e.error.type.includes('template-name-conflict');
}

/**
 * Document Library admin page — F.13b shell.
 *
 * Thin orchestrator: provides DocumentPageStateService at the page
 * subtree, mounts ExplorerLayoutComponent + PageToolbarComponent, and
 * subscribes to slot-emitted action subjects. The four slot components
 * (FoldersTree / Grid / Detail / StatusBar) communicate with this page
 * exclusively through the shared state service — no direct refs.
 *
 * Toolbar action dispatch is a hardcoded switch (matching Media's
 * pattern). No pluggable handler registry; the prompt's "ADR-062
 * ActionHandlerRegistry" doesn't exist in the codebase. Adding new
 * actions = editing the switch below.
 *
 * F.13b ships the action *plumbing* end-to-end but leaves three
 * dialogs as no-op alerts (Upload, New Folder, Delete confirmation).
 * F.13c lands those with the matching UI work.
 */
@Component({
    selector: 'app-document-library-page',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    // PageFooterService is non-root (must be page-scoped); without
    // it here, ExplorerLayoutComponent's <cms-page-footer /> can't
    // resolve its dependency and the route fails to mount with a
    // NullInjectorError.
    providers: [DocumentPageStateService, PageFooterService],
    imports: [
    FormsModule,
    CmsPageHeaderComponent,
    ExplorerLayoutComponent,
    ExplorerViewSwitcherComponent,
    PageToolbarComponent
],
    template: `
        <app-explorer-layout
            #layout
            layoutId="document:library"
            [context]="pageContext()"
            (backgroundClick)="onBackgroundClick()"
        >
            <cms-page-header
                explorer-header
                title="Documents"
                icon="file-earmark-text"
                [actions]="headerActions()"
                (actionClick)="onToolbarAction($event)"
            />

            <app-page-toolbar
                treeSlug="navi.toolbar.document"
                [alwaysShow]="true"
                [context]="toolbarContext()"
                (actionClick)="onToolbarAction($event)"
                (headerActionsChanged)="headerActions.set($event)"
            >
                @if (showInstancesFilters()) {
                    <!-- #1709 — SEARCH ONLY. The format and status selects that
                         used to sit here are per-column filters in the Details
                         grid now, which is where a filter belongs: they applied
                         to a listing whose other two renderings could not show
                         either field, so in tile mode they filtered invisibly.
                         Search stays because it is server-side — it reaches
                         rows the grid has not loaded. -->
                    <div toolbar-filters class="toolbar-instance-filters">
                        <input
                            type="search"
                            class="cms-input"
                            placeholder="Search filename…"
                            [ngModel]="state.instanceFilters().search"
                            (ngModelChange)="onInstanceSearch($event)"
                            aria-label="Search instances by filename"
                        />
                    </div>
                }

                <!-- The shared switcher, fed by the modes document:library
                     declares. Routes to whichever of the two view-mode signals
                     the current pane obeys — templates and instances keep
                     independent renderings on purpose (#1709). -->
                <app-explorer-view-switcher
                    toolbar-right-extra
                    [modes]="layout.viewModes()"
                    [active]="activeViewMode()"
                    (modeChange)="onViewMode($event)"
                />
            </app-page-toolbar>
        </app-explorer-layout>
    `,
    // Mirrors MediaLibraryPage exactly. Without these the page host
    // collapses to its content-intrinsic height instead of filling
    // the admin shell's main area, so ExplorerLayout's flex chain
    // can't pin the footer to the bottom of the viewport. `min-height:
    // 0` is load-bearing — without it the inner overflow:hidden
    // wrappers leak past their parent and the page scrolls instead of
    // its inner panes.
    styles: [`
        :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }

        .toolbar-instance-filters {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .toolbar-instance-filters .cms-input,
        .toolbar-instance-filters .cms-select {
            font-size: .8125rem;
            min-width: 0;
        }
        .toolbar-instance-filters input[type="search"] {
            width: 200px;
        }
        .toolbar-instance-filters select {
            width: 130px;
        }
    `],
})
export class DocumentLibraryPage implements OnInit {
    private readonly templatesSvc = inject(WordTemplateService);
    private readonly nativeDocuments = inject(NativeDocumentService);
    private readonly aggregator = inject(DocumentAggregatorService);
    private readonly formatInfo = inject(FormatInfoService);
    private readonly instances = inject(DocumentInstanceService);
    private readonly dialog = inject(Dialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly toast = inject(ToastService);
    private readonly http = inject(HttpClient);
    private readonly store = inject(Store);
    private readonly editorRegistry = inject(FileEditorRegistry);
    private readonly nativeDialog = inject(NativeDialogService);
    // #1684 — VFS mkdir + binary upload for the Documents view.
    private readonly api = inject(ApiService);
    private readonly confirmSvc = inject(ConfirmDialogService);
    private readonly esc = inject(EscCoordinatorService);
    private readonly router = inject(Router);

    protected readonly state = inject(DocumentPageStateService);

    /**
     * Header-bar actions sourced from the navi.toolbar.document tree
     * (nodes with `meta.position: 'header'`). The PageToolbarComponent
     * resolves them in NaviGraph mode and emits the resolved list via
     * `headerActionsChanged`; this signal forwards the list straight
     * into `<cms-page-header [actions]>` so Upload / New Folder
     * surface in the page header instead of the toolbar strip below.
     */
    protected readonly headerActions = signal<ToolbarAction[]>([]);

    constructor() {
        // Phase E3 (ADR-092 §3): register the panel-close ESC handler
        // only while the panel can actually consume it. When the panel
        // is closed the handler isn't on the stack — the context-menu
        // handler (registered via its own effect on `menu()`) gets the
        // keystroke instead. Fixes #4.8 double-close.
        effect((onCleanup) => {
            if (!this.state.propertiesPanelOpen()) {
                return;
            }
            const unregister = this.esc.register(() => {
                this.state.setPropertiesPanelOpen(false);
                return true;
            });
            onCleanup(unregister);
        });

        // Phase A: when the focused template changes, reset filters and
        // fetch the instance count for the badge. Effect (not Subject)
        // so the reset state is visible at the same change-detection
        // tick as the new template id — otherwise the toolbar's
        // `activeWhen` evaluates against the *previous* template's
        // mode for one frame.
        //
        // Phase D: dropped the `setRightPanelMode('properties')` call on
        // template selection. Right-click selects the entity to populate
        // the would-be Properties panel, but it should NOT also force
        // the panel mode — the user's prior mode (instances vs
        // properties) stays in effect. The deselection branch still
        // resets mode so the next template selection lands in a
        // predictable default.
        effect((onCleanup) => {
            const tpl = this.state.selectedTemplate();
            // Phase A.1b: any template change clears the focused
            // instance — stale instance properties from a previous
            // template would mislead the user.
            this.state.selectInstance(null);
            if (!tpl) {
                this.state.setInstanceCount(0);
                this.state.setRightPanelMode('properties');
                return;
            }
            this.state.resetInstanceFilters();
            const sub = this.instances
                .countForTemplate(tpl.id)
                .subscribe({
                    next: (count) => this.state.setInstanceCount(count),
                    error: () => this.state.setInstanceCount(0),
                });
            onCleanup(() => sub.unsubscribe());
        });

        // Phase D hotfix #4: removed the "clear selectedInstance on
        // leaving instances mode" effect. Selection now persists
        // across mode toggles (verification 15) — re-entering
        // instances mode lands the user back on their previously
        // focused instance.

        // Phase A.1a: clicking a folder in the tree while the user is
        // in instances mode is a clear navigation intent — return to
        // properties (folder browsing) layout. Tracking `currentPath`
        // separately from the template effect so a path change without
        // a template selected (background folder browsing) still
        // reverts mode.
        effect(() => {
            const path = this.state.currentPath();
            if (this.state.rightPanelMode() !== 'instances'
                || this.state.selectedTemplate() !== null) {
                return;
            }
            // #1683 — in the SPACE scope a path change is a change of
            // space, not an exit: rescope the listing and stay in the
            // Documents view. Read untracked because this effect also
            // WRITES the scope; tracking it would make the effect
            // depend on its own output.
            if (untracked(() => this.state.instancesScopePath()) !== null) {
                this.state.instancesScopePath.set(path);

                return;
            }
            this.state.setRightPanelMode('properties');
        });
    }

    /**
     * Context for slot components — the right detail panel reads
     * `activeItem` to know whether to render itself.
     *
     * Phase D hotfix #3: gated on `propertiesPanelOpen`. Selection alone
     * (e.g. from right-click) no longer auto-opens the panel; intent is
     * separated from data. Single-click handlers and the toolbar's
     * `mode-properties` toggle flip the visibility flag explicitly.
     */
    protected readonly pageContext = computed(() => {
        if (!this.state.propertiesPanelOpen()) {
            return { activeItem: null };
        }
        if (this.state.rightPanelMode() === 'instances') {
            return { activeItem: this.state.selectedInstance() };
        }
        return { activeItem: this.state.selectedTemplate() };
    });

    protected readonly showInstancesFilters = computed(() =>
        this.state.rightPanelMode() === 'instances'
            && (this.state.selectedTemplate() !== null
                // #1683 — the space scope lists instances too, so it
                // wants the same format / status / search filters.
                || this.state.instancesScopePath() !== null),
    );

    /**
     * Context for the toolbar's NaviGraph showWhen rules. Phase D
     * hotfix #2: dropped legacy `_context` / `_single` fields. They
     * were derived from `selectedTpl` alone and mis-matched on instance
     * state (where `selectedTpl` is also non-null) — predicates using
     * `_context eq 'template' AND _single eq true` would render
     * template-scoped actions even when the user had focused an
     * instance, producing the duplicate-toolbar regression.
     *
     * Now `_kind` is the single discriminator across both surfaces
     * (toolbar + context menu): `'background' | 'template' | 'instance'`.
     * `_selected` lets the right-side mode toggles activate as soon as
     * anything is in scope without enumerating both kinds.
     */
    protected readonly toolbarContext = computed(() => {
        const selectedTpl = this.state.selectedTemplate();
        const selectedInst = this.state.selectedInstance();
        const inInstancesMode = this.state.rightPanelMode() === 'instances';
        // Phase D hotfix #4: mode-precedence `_kind`. The active center
        // view dictates which selection drives the toolbar — instances
        // mode reads `selectedInstance`, templates mode reads
        // `selectedTemplate`. With selection now persisted across mode
        // toggles (hotfix #4 reverted effect 2), this stops the
        // toolbar from showing instance actions in templates mode just
        // because an instance is still in scope from the prior view.
        const kind = inInstancesMode
            ? (selectedInst ? 'instance' : 'background')
            : (selectedTpl ? 'template' : 'background');
        return {
            _surface: 'toolbar',
            _kind: kind,
            // #1683 — WHICH VIEW, as opposed to `_kind`'s WHAT IS
            // SELECTED. The two instance views share `_rightPanelMode`,
            // so without this a predicate cannot say "only where
            // templates live": Upload / New Template / New Folder were
            // matching `_surface eq toolbar` unconditionally and showed
            // over listings of generated documents.
            _view: this.state.browseView(),
            _selected: kind !== 'background',
            _selectedHasInstance: this.state.instanceCount() > 0,
            _viewMode: this.state.viewMode(),
            _rightPanelMode: this.state.rightPanelMode(),
            _instancesViewMode: this.state.instancesViewMode(),
            _instanceCount: this.state.instanceCount(),
            _status: selectedInst?.status ?? '',
            // Phase D hotfix #4: drives the mode-properties button's
            // pressed/active styling — it's now a true visibility toggle.
            _propertiesPanelOpen: this.state.propertiesPanelOpen(),
        };
    });

    ngOnInit(): void {
        // F.14c-1: load format-info early so the grid + upload dialog
        // can render icons / accept-strings against the canonical
        // backend payload. Errors are swallowed — the format-icons
        // fallback constants keep the UI usable while we re-attempt
        // on the next interaction.
        this.formatInfo
            .loadFormatInfo()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({ error: () => undefined });

        this.refresh();

        // Slots use the state service's subjects to ask the page to
        // do something — keeps the slot components free of HTTP and
        // dialog dependencies.
        this.state.refreshRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refresh());

        this.state.previewLatestRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((t) => this.runPreviewLatest(t));

        this.state.deleteRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((t) => this.runDelete(t));

        this.state.openInstanceRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(({ template, instance }) => this.openPreview(template, instance));

        this.state.templateOpenRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((t) => this.runOpenTemplate(t));

        this.state.actionDispatched$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((action) => this.onToolbarAction(action));

        // E6 — empty-area drop on folder-content: direct upload (no dialog).
        this.state.uploadFilesRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((files) => this.uploadFiles(files, this.state.currentPath()));

        // E6 — tree right-click "Upload here": dialog path, folder pre-set.
        this.state.uploadToFolderRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((path) => this.openUploadDialog(path));

        // #1684 — files dropped on the DOCUMENTS zone: straight to the
        // VFS at the current folder, no template detour.
        this.state.uploadDocumentsRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((files) =>
                this.uploadDocumentsTo(files, this.state.currentPath().replace(/\/+$/, '')),
            );

        // #1684 — "New folder here" targets the RIGHT-CLICKED folder.
        this.state.newFolderInRequested$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((path) => void this.runNewFolder(path));
    }

    protected onToolbarAction(action: string): void {
        switch (action) {
            case 'upload':
                this.openUploadDialog();
                break;
            case 'new-folder':
                void this.runNewFolder();
                break;
            case 'new-document':
                void this.runNewDocument();
                break;
            case 'upload-document':
                this.runUploadDocuments();
                break;
            case 'new-template':
                void this.runNewTemplate();
                break;
            case 'generate': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.runGenerate(t);
                }
                break;
            }
            case 'preview-instance': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.runPreviewLatest(t);
                }
                break;
            }
            case 'edit': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.openEditDialog(t);
                }
                break;
            }
            case 'replace': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.openReplaceDialog(t);
                }
                break;
            }
            case 'download-source': {
                const t = this.state.selectedTemplate();
                // Templates are now Nodes themselves — the template id IS
                // the backing file's id, regardless of format. Native
                // (DTMPL) templates also have downloadable bytes via VFS;
                // imported (DOCX) templates resolve to the uploaded
                // source. The "no source file" branch is gone with the
                // legacy `sourceFileId` field.
                if (t) {
                    const url = this.instances.getDownloadUrl(t.id, {
                        disposition: 'attachment',
                        filename: this.templateFilename(t),
                    });
                    window.location.href = url;
                }
                break;
            }
            case 'delete-template': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.runDelete(t);
                }
                break;
            }
            case 'view-template': {
                const t = this.state.selectedTemplate();
                if (t) {
                    this.runOpenTemplate(t);
                }
                break;
            }
            case 'view-instance': {
                const i = this.state.selectedInstance();
                if (i) {
                    // #1683 — the template is only a source of NAMES here,
                    // and the space-scoped Documents view has none
                    // selected. Requiring one made View and double-click
                    // silently no-op there — the same
                    // guard-returns-quietly shape as #1682.
                    this.openPreview(this.state.selectedTemplate(), i);
                }
                break;
            }
            case 'download-instance': {
                const i = this.state.selectedInstance();
                if (i?.generatedFileId) {
                    const url = this.instances.getDownloadUrl(i.generatedFileId, {
                        disposition: 'attachment',
                        filename: this.instanceFilename(i),
                    });
                    window.location.href = url;
                }
                break;
            }
            case 'regenerate': {
                const i = this.state.selectedInstance();
                if (i) {
                    this.runRegenerateInstance(i);
                }
                break;
            }
            case 'delete-instance': {
                const i = this.state.selectedInstance();
                if (i) {
                    this.runDeleteInstance(i);
                }
                break;
            }
            case 'properties':
                // Phase D hotfix #4: context-menu Properties action just
                // opens the panel. The right-click handler already wrote
                // selection; the panel content reflects whichever entity
                // is in scope (template or instance) per the current
                // mode.
                this.state.setPropertiesPanelOpen(true);
                break;
            case 'mode-properties':
                // Phase D hotfix #4: single semantic — toggle panel
                // visibility. No mode change, no selection clearing.
                // (Hotfix #3's overload split between transition vs
                // toggle is reverted; `mode-instances` is now the only
                // center-mode switcher.)
                this.state.togglePropertiesPanelOpen();
                break;
            case 'mode-instances': {
                // Phase D hotfix #4: pure center-mode switcher between
                // templates view (folder-content) and instances view
                // (instances-browser). Selection persists per-view —
                // returning to instances mode later still has the
                // previously-focused instance in scope.
                const next = this.state.rightPanelMode() === 'instances' ? 'properties' : 'instances';
                this.state.setRightPanelMode(next);
                break;
            }
        }
    }

    /**
     * Which rendering the switcher should show as pressed (#1709).
     *
     * The two panes keep INDEPENDENT modes — a user may want the templates as
     * tiles and the documents they produced as a table — so the one control
     * reads and writes whichever signal belongs to the pane on screen.
     */
    protected readonly activeViewMode = computed<ExplorerViewMode>(() =>
        'instances' === this.state.rightPanelMode()
            ? this.state.instancesViewMode()
            : this.state.viewMode(),
    );

    protected onViewMode(mode: ExplorerViewMode): void {
        if ('instances' === this.state.rightPanelMode()) {
            this.state.instancesViewMode.set(mode);

            return;
        }
        this.state.viewMode.set(mode);
    }

    protected onInstanceSearch(value: string): void {
        this.state.setInstanceFilter('search', value);
    }

    /**
     * Phase A.1b: in instances mode, background click closes only the
     * instance properties panel — the template stays focused so the
     * user remains in the file zone. In properties mode the click
     * clears template selection (legacy behavior).
     *
     * Phase D hotfix #3: also closes the panel-visibility flag so that
     * a subsequent right-click doesn't re-open the panel via the stale
     * "user once had it open" preference.
     */
    protected onBackgroundClick(): void {
        if (this.state.rightPanelMode() === 'instances') {
            this.state.selectInstance(null);
        } else {
            this.state.selectedId.set(null);
        }
        this.state.setPropertiesPanelOpen(false);
    }

    // Phase E3: ESC handler migrated to EscCoordinatorService (LIFO
    // stack per ADR-092) — registration lives in the constructor
    // effect tied to `propertiesPanelOpen()` so the handler is only
    // on the stack when the panel can actually consume the ESC.
    // Fixes regression-smoke deviation #4.8 (panel + menu double-close):
    // context menu pushes a later handler onto the same stack on open,
    // takes priority on the first ESC, leaves the panel for the
    // second.

    private refresh(): void {
        this.state.loading.set(true);
        // F.14c-1: list via the cross-format aggregator so future
        // format modules surface in the grid the moment they ship —
        // no per-format `templatesSvc.list()` plumbing needed.
        this.aggregator
            .listTemplates()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (list) => {
                    this.state.templates.set(list);
                    this.state.loading.set(false);
                    // If the previously selected template went away,
                    // drop selection so the detail panel collapses.
                    const id = this.state.selectedId();
                    if (id !== null && !list.some((t) => t.id === id)) {
                        this.state.selectedId.set(null);
                    }
                },
                error: () => this.state.loading.set(false),
            });
    }

    private openUploadDialog(folderPath?: string): void {
        const ref = this.dialog.open<DocumentTemplate | null, DocumentUploadDialogData>(
            DocumentUploadDialog,
            {
                hasBackdrop: true,
                data: { folderPath: folderPath ?? this.state.currentPath() },
            },
        );

        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((template) => {
            if (!template) {
                return;
            }
            this.toast.success(`Uploaded ${template.name}.`);
            this.reportConversion(template);
            this.refresh();
            this.state.selectedId.set(template.id);
        });
    }

    /**
     * Tell the operator what converting cost them.
     *
     * A toast is the wrong shape: this is a LIST, it is the reason the choice
     * existed, and it disappears before anyone reads three lines of it. A
     * dialog with no Cancel is an alert — `cancelLabel: ''` hides the button
     * and leaves the X and the backdrop, which is exactly right for something
     * there is nothing to decide about.
     *
     * Silent when nothing was lost, and silent for an ordinary upload: the
     * field is absent unless a conversion actually happened.
     */
    private reportConversion(template: DocumentTemplate): void {
        const notes = template.conversionNotes ?? [];
        if (notes.length === 0) {
            return;
        }

        void this.nativeDialog.confirm({
            title: 'Converted — some things did not carry over',
            message: [
                `"${template.name}" is now editable here, and your original file is kept beside it.`,
                '',
                ...notes.map(note => `• ${note}`),
            ].join('\n'),
            confirmLabel: 'Got it',
            cancelLabel: '',
        });
    }

    /**
     * E6 — direct upload path used by the empty-area dropzone. One POST
     * per file against `folderPath` via the same aggregator the upload
     * dialog uses. Toast-success per file; on the last completion the
     * folder reloads and the most recent template becomes selected.
     */
    private uploadFiles(files: File[], folderPath: string): void {
        if (files.length === 0) return;
        let remaining = files.length;
        let lastUploaded: DocumentTemplate | null = null;
        const onSettled = (template: DocumentTemplate | null): void => {
            if (template !== null) {
                lastUploaded = template;
            }
            if (--remaining === 0) {
                this.refresh();
                if (lastUploaded !== null) {
                    this.state.selectedId.set(lastUploaded.id);
                }
            }
        };
        for (const file of files) {
            void this.uploadOneWithConflictResolution(file, folderPath, onSettled);
        }
    }

    /**
     * Per-file upload driver for the drag-drop path. Mirrors
     * `document-upload.dialog`'s conflict-resolution flow: on a 409
     * the TemplateConflictDialog opens with the three actions
     * (Replace existing / Save with new name / Cancel). Save-as
     * retries with a renamed File, recursing if the new name also
     * collides; Replace launches the Replace flow with the file
     * pre-loaded; Cancel aborts that single file without affecting
     * the rest of the dropped batch.
     */
    private async uploadOneWithConflictResolution(
        file: File,
        folderPath: string,
        onSettled: (template: DocumentTemplate | null) => void,
    ): Promise<void> {
        try {
            const template = await firstValueFrom(this.aggregator.uploadTemplate(file, folderPath));
            this.toast.success(`Uploaded ${template.name}.`);
            onSettled(template);
        } catch (err: unknown) {
            if (isTemplateNameConflict(err)) {
                const replaced = await this.resolveNameConflict(file, folderPath, err.error);
                onSettled(replaced);
                return;
            }
            this.toast.error(`Failed to upload ${file.name}: ${this.extractUploadErrorMessage(err)}`);
            onSettled(null);
        }
    }

    /**
     * Open the Template-Name-Conflict dialog and dispatch the user's
     * choice. Returns the resulting template on success (replace or
     * save-as), `null` when the user cancelled or the resulting
     * Replace flow was aborted.
     */
    private async resolveNameConflict(
        file: File,
        folderPath: string,
        payload: TemplateNameConflictPayload,
    ): Promise<DocumentTemplate | null> {
        const ref = this.dialog.open<TemplateConflictDialogResult | null, TemplateConflictDialogData>(
            TemplateConflictDialogComponent,
            {
                data: {
                    existing:      payload.existing,
                    suggestedName: payload.suggestedName,
                    proposedFile:  file,
                    folderPath:    payload.folderPath,
                },
                hasBackdrop: true,
            },
        );
        const result = await firstValueFrom(ref.closed);
        if (!result || result.action === 'cancel') {
            return null;
        }
        if (result.action === 'replace') {
            try {
                const template = await firstValueFrom(this.aggregator.getTemplate(payload.existing.id));
                const replaceRef = this.dialog.open<DocumentTemplate | null, ReplaceTemplateDialogData>(
                    ReplaceTemplateDialogComponent,
                    {
                        data: { template, preLoadedFile: file },
                        hasBackdrop: true,
                    },
                );
                return (await firstValueFrom(replaceRef.closed)) ?? null;
            } catch (replaceErr: unknown) {
                this.toast.error(
                    `Could not open Replace flow for ${payload.existing.name}: ${this.extractUploadErrorMessage(replaceErr)}`,
                );
                return null;
            }
        }
        // save-as — retry with the renamed File. May 409 again; the
        // recursion terminates when the user picks a non-colliding
        // name or cancels.
        const renamed = new File([file], result.newName ?? payload.suggestedName, { type: file.type });
        try {
            const template = await firstValueFrom(this.aggregator.uploadTemplate(renamed, folderPath));
            this.toast.success(`Uploaded ${template.name}.`);
            return template;
        } catch (retryErr: unknown) {
            if (isTemplateNameConflict(retryErr)) {
                return this.resolveNameConflict(renamed, folderPath, retryErr.error);
            }
            this.toast.error(`Failed to upload ${renamed.name}: ${this.extractUploadErrorMessage(retryErr)}`);
            return null;
        }
    }

    /**
     * Pull a user-readable message off an HTTP error. RFC 7807
     * payloads carry it as `detail`; non-API-Platform errors land on
     * `message`. Falls back to a generic notice.
     */
    private extractUploadErrorMessage(err: unknown): string {
        if (typeof err === 'object' && err !== null) {
            const e = err as { error?: { detail?: string }; message?: string };
            return e.error?.detail ?? e.message ?? 'Upload failed.';
        }
        if (err instanceof Error) {
            return err.message;
        }
        return 'Upload failed.';
    }

    /**
     * F.14c-3a — open the Edit Template metadata dialog. On save the
     * template list is refreshed so the new label / suffix / default
     * format surface immediately in folder content + the Generate
     * dialog. Existing rendered instances are unaffected (Option A's
     * per-instance vfsPath model).
     */
    private openEditDialog(template: DocumentTemplate): void {
        const ref = this.dialog.open<DocumentTemplate | null, EditTemplateDialogData>(
            EditTemplateDialogComponent,
            {
                data: { template },
                hasBackdrop: true,
            },
        );
        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((updated) => {
            if (!updated) {
                return;
            }
            this.refresh();
        });
    }

    /**
     * F.14c-3b — open the 2-phase Replace Template dialog. On commit
     * the template list refreshes so the new schema (if changed via
     * the adaptive policy) surfaces in the Generate dialog without
     * a page reload. Existing rendered instances are unchanged per
     * Option A.
     */
    private openReplaceDialog(template: DocumentTemplate): void {
        const ref = this.dialog.open<DocumentTemplate | null, ReplaceTemplateDialogData>(
            ReplaceTemplateDialogComponent,
            {
                data: { template },
                hasBackdrop: true,
            },
        );
        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((updated) => {
            if (!updated) {
                return;
            }
            this.refresh();
        });
    }

    private runGenerate(template: DocumentTemplate): void {
        const ref = this.dialog.open<
            CmsDocumentGenerationWizardResult | null,
            CmsDocumentGenerationWizardData
        >(CmsDocumentGenerationWizardComponent, {
            data: { template },
            hasBackdrop: true,
            disableClose: true,
        });

        ref.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
            if (result?.generationId) {
                this.toast.info('Generation started -- viewing progress now.');
                this.router.navigate(['/documents/generations', result.generationId]);
            }
        });
    }

    /**
     * `template` is nullable because the space-scoped Documents view
     * (#1683) has no template in scope — it is used for naming only,
     * and the instance's own VFS filename is the better fallback
     * anyway (it is what the file is actually called on disk).
     */
    private openPreview(template: DocumentTemplate | null, instance: DocumentInstance): void {
        if (!instance.generatedFileId) {
            return;
        }
        const mime = this.instances.inferMimeType(instance);
        if (!mime) {
            // #1691 — no VIEWER for this format does not mean nothing can
            // open it. `text/*` has been registered to the CodeEditor all
            // along, so a `.txt` in the docs folder opened fine from the
            // VFS file manager and answered "use Download" here. Same
            // lesson as #1676/#1670 for templates: Documents simply never
            // asked the editor registry. Falls back to the toast only when
            // BOTH registries miss.
            this.openInRegisteredEditor(
                instance.vfsPath ?? '',
                'No in-browser viewer for this format — use Download.',
            );

            return;
        }
        const filename = template
            ? `${template.slug}.${instance.outputFormat}`
            : this.instanceFilename(instance);
        const data: ViewerModalData = {
            // xlsx / pptx are shown as a PDF rendition (#1788) — the viewer
            // reads that, while Download below still hands over the REAL file.
            fileUrl: this.instances.previewUrl(instance.generatedFileId, instance.outputFormat)
                ?? this.instances.getDownloadUrl(instance.generatedFileId, { disposition: 'inline' }),
            downloadUrl: this.instances.getDownloadUrl(instance.generatedFileId, {
                disposition: 'attachment',
                filename,
            }),
            mimeType: mime,
            filename,
            title: template
                ? `${template.name} — ${instance.outputFormat.toUpperCase()}`
                : `${filename} — ${instance.outputFormat.toUpperCase()}`,
        };
        this.dialog.open<void, ViewerModalData>(ViewerModalComponent, {
            data,
            hasBackdrop: true,
        });
    }

    /**
     * F.14c-3 — Preview Latest opens the most recently rendered
     * instance for the selected template. Drives off the new
     * `?filter=templateId eq ...` collection: pick the freshest
     * `rendered` row by `generatedAt`. Falls back to a toast when
     * the template has no rendered instances yet.
     */
    private runPreviewLatest(template: DocumentTemplate): void {
        this.instances
            .listForTemplate(template.id, { status: 'rendered', limit: 1, sortKey: 'generatedAt', sortDir: 'desc' })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ items }) => {
                    const latest = items.find((i) => i.generatedFileId);
                    if (!latest) {
                        this.toast.info('No rendered instances yet.');
                        return;
                    }
                    this.openPreview(template, latest);
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }

    /**
     * Phase B: source-aware double-click viewer dispatch.
     *
     * Imported templates (`native: false`) preview through ViewerModal
     * keyed by `sourceMimeType`; the existing F.7 ViewerHost picks the
     * right format (DocxViewer for DOCX, PdfViewer for PDF, …).
     *
     * Native templates (`native: true`) open whatever editor the
     * `FileEditorRegistry` has for their MIME — `text/x-dtmpl` is already
     * registered to `DtmplEditorDialogComponent` (#1676). This used to be a
     * "coming soon" toast, while the SAME file opened fine from the VFS file
     * manager, which routes through that registry. Nothing needed building:
     * Documents simply never asked.
     */
    /**
     * Open a native template in whatever editor is registered for its MIME.
     *
     * The node is fetched rather than fabricated from the template DTO: the
     * registry keys on `mimeType`/`type`, and every editor takes the whole
     * `VfsNodeDto` — `DtmplEditorDialogComponent` loads and saves BY PATH and
     * also reads `name` and `mimeType`. Hand-building a partial would work
     * today and break the first time an editor reads a field we did not
     * bother to set.
     */
    private openNativeTemplate(template: DocumentTemplate): void {
        this.openInRegisteredEditor(
            template.path ?? '',
            'No editor is registered for this template format.',
        );
    }

    /**
     * Open the VFS node at `path` in whatever editor the registry has for
     * its MIME; `missMessage` is shown when nothing is registered.
     *
     * Shared by the template path (#1676) and the instance path (#1691) —
     * an instance is a VFS file like any other, and the reason `.txt`
     * could not be opened was that only templates ever consulted this.
     */
    private openInRegisteredEditor(path: string, missMessage: string): void {
        const base = this.store.selectSnapshot(AppConfigState.manifest)?.apiBase ?? '';
        if ('' === base || '' === path) {
            this.toast.error('Cannot resolve this file on disk.');

            return;
        }

        this.http
            .get<VfsNodeDto>(`${base}/vfs/files?path=${encodeURIComponent(path)}`, {
                headers: { Accept: 'application/ld+json' },
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (node) => {
                    if (!this.editorRegistry.openFor(node)) {
                        // Registry miss is a real answer, not a placeholder:
                        // this format simply has no editor installed.
                        this.toast.info(missMessage);
                    }
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }

    /**
     * Create an empty NATIVE template and open it in the editor (#1680).
     *
     * A native template has no source file to upload — it is authored in
     * place — so "New Template" is a name prompt, not an upload. The slug is
     * derived from the name because asking an operator for a slug is asking
     * them to do the machine's job; a collision comes back as a 422 the
     * humaniser surfaces.
     *
     * #1687 — that derivation now happens SERVER-side. The local fold here
     * was `[^a-z0-9]+`, which cannot transliterate: `Счета` folded to the
     * empty string and the operator got "no characters a slug can be built
     * from" for a perfectly good name.
     *
     * Lands in the CURRENT folder's space: `outputBasePath` is not involved,
     * the create endpoint resolves the space's `.templates/` itself.
     *
     * The prompt also asks WHICH FORMAT. It did not until now, and the
     * omission stranded a whole backend: `.dsheet` templates have been
     * mintable (#1987), renderable (#1990) and editable in the grid (#1991)
     * while the only reachable answer here was Word.
     *
     * The option list is the backend's, read off `/document/format-info` —
     * every format whose provider names a native source mime, which is
     * exactly the set that has an editor behind it. Not a hard-coded
     * Word/Spreadsheet pair and not a second toolbar button per format:
     * either would have to be edited again for the next native format,
     * and a button would additionally need a NaviGraph re-seed to appear.
     */
    private async runNewTemplate(): Promise<void> {
        const choices = this.formatInfo
            .nativeAuthoringFormats()
            .map((f) => ({ value: f.format, label: f.label }));

        // One option is not a choice — keep the plain name prompt rather than
        // a select the operator can only agree with. NONE means the
        // format-info payload has not arrived, failed, or came from a backend
        // predating the flag; falling back to 'word' degrades to exactly the
        // behaviour this action had before the choice existed, which beats
        // blocking template creation on a metadata fetch.
        // Which option is PRE-selected is not the registry's to decide. The
        // list arrives in DI tag order, which today puts Spreadsheet first —
        // so an operator who has always made Word templates by typing a name
        // and pressing Create would silently start making spreadsheets, and
        // the default would shift again whenever a module is added. Word is
        // named here because it is the format this action produced before the
        // choice existed, not because the list is hard-coded; if Word ever
        // stops being natively authorable the dialog falls back to the first
        // option on offer.
        const preferred = choices.some((c) => 'word' === c.value) ? 'word' : undefined;

        const result = choices.length > 1
            ? await this.nativeDialog.inputWithSelect({
                title: 'New Template',
                selectLabel: 'Format',
                choices,
                initialChoice: preferred,
                label: 'Template name',
                placeholder: 'Invoice',
                confirmLabel: 'Create',
                required: true,
            })
            : await this.nativeDialog
                .input({
                    title: 'New Template',
                    label: 'Template name',
                    placeholder: 'Invoice',
                    confirmLabel: 'Create',
                    required: true,
                })
                .then((name) => (null === name
                    ? null
                    : { value: name, choice: choices[0]?.value ?? 'word' }));

        if (null === result || '' === result.value.trim()) {
            return;
        }

        this.templatesSvc.createNative(result.value.trim(), result.choice)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (created) => {
                    this.state.refreshRequested$.next();
                    this.toast.success('Template created', created.name);
                    // Straight into the editor — a brand-new template is empty,
                    // so the only useful next step is writing it.
                    this.openNativeTemplate(created);
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }

    /**
     * #1684 — create a subfolder in the CURRENT documents folder.
     *
     * Never under `.templates`: the NaviGraph node is gated on
     * `_view eq 'documents'`, and templates are per-space anyway, so a
     * subfolder there would be inert. The folder NAME is a slug, per the
     * platform's slug-naming convention; the typed title is what the
     * user sees in the chip and the breadcrumb.
     */
    private async runNewFolder(targetPath?: string): Promise<void> {
        const title = await this.nativeDialog.input({
            title: 'New Folder',
            label: 'Folder name',
            placeholder: 'Invoices',
            confirmLabel: 'Create',
            required: true,
        });
        if (null === title || '' === title.trim()) {
            return;
        }

        // #1685 — the TITLE goes to the server, which slugs it with the
        // platform's national transliteration rules and stores the title
        // on the Node. Folding locally was the outlier: every other
        // create path on the platform (Page, Article) already posts a
        // title and lets the backend name the thing.
        const parent = (targetPath ?? this.state.currentPath()).replace(/\/+$/, '');
        this.api
            .mkdirTitled(parent, title.trim())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (node) => {
                    this.state.bumpFolderVersion();
                    this.toast.success('Folder created', node.title ?? node.name);
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }

    /**
     * Create an empty NATIVE document and open it in the editor (#1774).
     *
     * The counterpart to {@link runNewTemplate}: same prompt-then-author flow,
     * one folder over. A document has no source file to upload — it is written
     * here — so this is a name-and-format prompt, not a file picker.
     *
     * Between the two entries the operator reaches all four combinations the
     * platform supports — Word template, Word document, Spreadsheet template,
     * Spreadsheet document. They are grouped by template-vs-document rather
     * than offered as one flat list of four because the two menu entries come
     * from the NaviGraph: collapsing them into one would need a re-seed, and
     * the axis that actually changes behaviour (a template is generated FROM,
     * a document IS the artifact) is the one worth keeping visible.
     *
     * Lands in the CURRENT documents folder, which is the one visible
     * difference from New Template: a template belongs to its space's
     * `.templates/` and the server resolves that, while a document goes
     * wherever the operator is standing.
     *
     * The TITLE goes to the server, which slugs it with national
     * transliteration and stores the title on the Node — the platform rule
     * every other create path follows since [#1685].
     */
    private async runNewDocument(): Promise<void> {
        // #2054 — the same FORMAT choice New Template offers, and for the same
        // reason: a whole backend was stranded behind a prompt that could only
        // answer Word. `.dsheet` documents are mintable, seeded with a
        // parseable grid, and editable — but until now unreachable, because
        // this dialog asked for a name and nothing else.
        //
        // Read off `/document/format-info` rather than hard-coded, so the next
        // natively-authorable format appears here without another edit; the
        // same list, the same Word-preferred default and the same
        // single-option degradation as runNewTemplate, because an operator
        // should not meet two different pickers for the same decision.
        const choices = this.formatInfo
            .nativeAuthoringFormats()
            .map((f) => ({ value: f.format, label: f.label }));
        const preferred = choices.some((c) => 'word' === c.value) ? 'word' : undefined;

        const result = choices.length > 1
            ? await this.nativeDialog.inputWithSelect({
                title: 'New Document',
                selectLabel: 'Format',
                choices,
                initialChoice: preferred,
                label: 'Document name',
                placeholder: 'Lease agreement',
                confirmLabel: 'Create',
                required: true,
            })
            : await this.nativeDialog
                .input({
                    title: 'New Document',
                    label: 'Document name',
                    placeholder: 'Lease agreement',
                    confirmLabel: 'Create',
                    required: true,
                })
                .then((name) => (null === name ? null : { value: name, choice: choices[0]?.value }));

        if (null === result || '' === result.value.trim()) {
            return;
        }

        const folder = this.state.currentPath().replace(/\/+$/, '');
        this.nativeDocuments
            .create(folder, result.value.trim(), result.choice)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (created) => {
                    this.state.refreshRequested$.next();
                    this.toast.success('Document created', created.title);
                    // Straight into the editor — a brand-new document is empty,
                    // so the only useful next step is writing it.
                    this.openInRegisteredEditor(
                        created.path,
                        'No editor is registered for this document format.',
                    );
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }

    /**
     * #1684 — upload arbitrary documents into the current docs folder.
     *
     * Distinct from `upload` (Upload Template), which routes through the
     * template service and appends `.templates`. Not every document a
     * user has is a template, and the one that is not had nowhere to go.
     */
    private runUploadDocuments(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', () => {
            const files = Array.from(input.files ?? []);
            if (0 === files.length) {
                return;
            }
            this.uploadDocumentsTo(files, this.state.currentPath().replace(/\/+$/, ''));
        });
        input.click();
    }

    private uploadDocumentsTo(files: readonly File[], folderPath: string): void {
        let remaining = files.length;
        let failed = 0;
        for (const file of files) {
            this.api
                .uploadBinary(file, folderPath)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: () => {
                        if (0 === --remaining) {
                            this.finishDocumentUpload(files.length, failed);
                        }
                    },
                    error: (err: Error) => {
                        failed += 1;
                        this.toast.error(`${file.name}: ${err.message}`);
                        if (0 === --remaining) {
                            this.finishDocumentUpload(files.length, failed);
                        }
                    },
                });
        }
    }

    private finishDocumentUpload(total: number, failed: number): void {
        this.state.refreshInstancesRequested$.next();
        const uploaded = total - failed;
        if (uploaded > 0) {
            this.toast.success(`Uploaded ${uploaded} document${1 === uploaded ? '' : 's'}`);
        }
    }

    private runOpenTemplate(template: DocumentTemplate): void {
        if (template.native) {
            this.openNativeTemplate(template);
            return;
        }
        const mime = template.sourceMimeType ?? inferTemplateSourceMime(template.format, template.native);
        if (!mime) {
            this.toast.info('No in-browser viewer for this template format.');
            return;
        }
        // Template id == backing VFS Node id == file id for download.
        const filename = `${template.slug}${this.extensionForMime(mime)}`;
        const data: ViewerModalData = {
            // Same rendition rule as an instance (#1788): an UPLOADED xlsx or
            // pptx template is just as unviewable as a generated one, and it is
            // the surface an operator checks before generating from it.
            fileUrl: this.instances.previewUrl(template.id, this.extensionForMime(mime).replace('.', ''))
                ?? this.instances.getDownloadUrl(template.id, { disposition: 'inline' }),
            downloadUrl: this.instances.getDownloadUrl(template.id, {
                disposition: 'attachment',
                filename,
            }),
            mimeType: mime,
            filename,
            title: template.name,
        };
        this.dialog.open<void, ViewerModalData>(ViewerModalComponent, {
            data,
            hasBackdrop: true,
        });
    }

    /**
     * Name a template's source download after what the source actually is.
     *
     * The call site spelled `slug + '.docx'` for every template — wrong the
     * moment native Word landed (a `.dtmpl` source downloading as `.docx`),
     * and plainly wrong once the admin could create native SPREADSHEET
     * templates, whose source is a `.dsheet`. Same single-format leftover
     * #1778 found in the output-format dropdown and #1779 in the preview
     * dispatch above.
     */
    private templateFilename(template: DocumentTemplate): string {
        return templateSourceFilename(template, (mime) => this.formatInfo.extensionForMime(mime));
    }

    /**
     * Extension for a source mime, backend first: `format-info` pairs each
     * format's mimes with its extensions, so a format module names its own
     * and nothing here changes. The local map behind it only covers the
     * payload-missing case.
     */
    private extensionForMime(mime: string): string {
        return extensionForSourceMime(mime, this.formatInfo.extensionForMime(mime));
    }

    private instanceFilename(instance: DocumentInstance): string {
        const fallback = instance.name && instance.name.length > 0
            ? `${instance.name}.${instance.outputFormat}`
            : `${instance.id.slice(0, 8)}.${instance.outputFormat}`;
        return filenameOf(instance.vfsPath, fallback);
    }

    private runRegenerateInstance(instance: DocumentInstance): void {
        this.instances
            .regenerateInstance(instance.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (newInstance) => {
                    this.toast.info('Regenerating — new instance pending.');
                    this.state.refreshInstancesRequested$.next();
                    this.state.selectInstance(newInstance);
                },
                error: (err: Error) => this.toast.error('Regenerate failed: ' + (err.message ?? 'unknown error')),
            });
    }

    private runDeleteInstance(instance: DocumentInstance): void {
        // Phase D hotfix #5: replaced `window.confirm` with the
        // CMS-themed `ConfirmDialogService.confirmDelete` (same dialog
        // Media Library uses) so the destructive prompt matches the
        // rest of the admin shell.
        this.confirmSvc
            .confirmDelete(this.instanceFilename(instance))
            .pipe(
                filter(Boolean),
                switchMap(() => this.instances.deleteInstance(instance.id)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success('Instance deleted.');
                    if (this.state.selectedInstance()?.id === instance.id) {
                        this.state.selectInstance(null);
                    }
                    this.state.refreshInstancesRequested$.next();
                },
                error: (err: Error) => this.toast.error('Delete failed: ' + (err.message ?? 'unknown error')),
            });
    }

    private runDelete(template: DocumentTemplate): void {
        this.confirmSvc
            .confirmDelete(template.name)
            .pipe(
                filter(Boolean),
                switchMap(() => this.templatesSvc.delete(template.id)),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
                next: () => {
                    this.toast.success(`Deleted ${template.name}.`);
                    this.state.selectedId.set(null);
                    this.refresh();
                },
                error: (err: Error) => this.toast.error(err.message),
            });
    }
}
